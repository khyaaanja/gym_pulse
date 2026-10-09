import { assertCanActivateMember } from "@/lib/limits";
import { prisma, type Tx } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { decryptJson, randomToken } from "@/lib/crypto";
import { securityEvent, audit, type AuditActor } from "@/lib/audit";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { log } from "@/lib/logger";
import { localDate, today as todayIn } from "@/lib/time";
import type { Gym, Member, Payment, PaymentMethod, ProviderEnvironment } from "@/generated/prisma/client";
import { renewMembership } from "../memberships";
import { onMemberRenewed } from "../recovery";
import { onMarketplacePurchase, onPaymentFailed } from "../automation";
import { notify } from "../notifications";
import { enqueue } from "../jobs";
import { PAYMENT_ADAPTERS, VerificationError, testGatewayEnabled, type CheckoutInstruction, type VerifiedEvent } from "./providers";
import { applyCoupon, recordCouponRedemption, releaseCouponReservation, reserveCoupon } from "../coupons";
import { releaseOrderInventory } from "../marketplace";
import { MONEY_TX } from "@/lib/tx";

export const newReference = () => `GP-${Date.now().toString(36).toUpperCase()}-${randomToken(6).replace(/[-_]/g, "X").toUpperCase()}`;

type ProviderResolved = { key: string; env: ProviderEnvironment; creds: Record<string, string>; displayName: string };

/**
 * A provider is usable for a gym when the platform has it enabled AND (for real gateways) the
 * gym has connected its own merchant credentials. The sandbox needs no merchant credentials and
 * is offered only when explicitly enabled outside production (see testGatewayEnabled).
 */
export async function availableProviders(gymId: string): Promise<ProviderResolved[]> {
  const rows = await prisma.paymentProviderConfig.findMany({ where: { OR: [{ gymId: null }, { gymId }] } });
  const out: ProviderResolved[] = [];
  for (const platform of rows.filter((r) => r.gymId === null && r.enabled)) {
    if (platform.providerKey === "sandbox") {
      if (testGatewayEnabled()) out.push({ key: "sandbox", env: "SANDBOX", creds: {}, displayName: platform.displayName });
      continue;
    }
    const gymRow = rows.find((r) => r.gymId === gymId && r.providerKey === platform.providerKey && r.enabled);
    if (!gymRow) continue;
    out.push({ key: gymRow.providerKey, env: gymRow.environment, creds: decryptJson(gymRow.credentialsEnc) ?? {}, displayName: platform.displayName });
  }
  return out;
}

async function providerFor(gymId: string, key: string) {
  const p = (await availableProviders(gymId)).find((x) => x.key === key);
  if (!p) throw new AppError(400, "provider_unavailable", "That payment method isn't available. Please choose another.");
  const adapter = PAYMENT_ADAPTERS[key];
  if (!adapter) throw new AppError(400, "provider_unavailable", "Unknown payment provider.");
  return { ...p, adapter };
}

// ─────────────────────────────── Checkout ───────────────────────────────

export async function startMembershipCheckout(
  gym: Gym,
  member: Member,
  input: { planId: string; provider: string; couponCode?: string | null },
): Promise<{ payment: Payment; instruction: CheckoutInstruction }> {
  const db = tenantDb(gym.id);
  const plan = await db.membershipPlan.findFirst({ where: { id: input.planId, active: true } });
  if (!plan) throw notFound("That plan isn't available.");
  const discount = input.couponCode ? await applyCoupon(gym.id, member.id, input.couponCode, "MEMBERSHIP", plan.pricePaisa) : null;
  const amount = plan.pricePaisa - (discount?.discountPaisa ?? 0);
  if (amount <= 0) throw badRequest("This coupon can't be used for a full-price waiver online. Please ask the front desk.");
  await assertCanActivateMember(gym, member);
  const provider = await providerFor(gym.id, input.provider);

  // The coupon is reserved in the same transaction as the payment, so limits hold across concurrent checkouts.
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        purpose: "MEMBERSHIP",
        method: "ONLINE",
        provider: provider.key,
        reference: newReference(),
        amountPaisa: amount,
        discountPaisa: discount?.discountPaisa ?? 0,
        couponId: discount?.couponId ?? null,
        planId: plan.id,
        status: "PENDING",
      },
    });
    if (discount) await reserveCoupon(tx, discount.couponId, member.id, { paymentId: p.id });
    return p;
  }, MONEY_TX);
  const instruction = await initiate(provider, payment, `${gym.name} — ${plan.name}`, member);
  return { payment, instruction };
}

export async function startOrderCheckout(gym: Gym, member: Member, orderId: string, providerKey: string) {
  const db = tenantDb(gym.id);
  const order = await db.marketplaceOrder.findFirst({ where: { id: orderId, memberId: member.id } });
  if (!order) throw notFound("Order not found.");
  if (order.status !== "PENDING_PAYMENT") throw badRequest("This order has already been paid or cancelled.");
  const provider = await providerFor(gym.id, providerKey);
  if (await db.payment.findFirst({ where: { orderId: order.id, status: "SUCCEEDED" } })) throw badRequest("This order is already paid.");
  // Every attempt gets its own row and reference. Reusing one would orphan an attempt the customer already paid
  // (its return/webhook would no longer match anything).
  const payment = await db.payment.create({
    data: {
      gymId: gym.id,
      memberId: member.id,
      orderId: order.id,
      purpose: "MARKETPLACE_ORDER",
      method: "ONLINE",
      provider: provider.key,
      reference: newReference(),
      amountPaisa: order.totalPaisa,
      discountPaisa: order.discountPaisa,
      couponId: order.couponId,
      status: "PENDING",
    },
  });
  const instruction = await initiate(provider, payment, `${gym.name} — Order ${order.number}`, member);
  return { payment, instruction };
}

async function initiate(provider: Awaited<ReturnType<typeof providerFor>>, payment: Payment, productName: string, member: Member) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const returnUrl = `${base}/api/payments/return/${provider.key}?ref=${encodeURIComponent(payment.reference)}`;
  try {
    const res = await provider.adapter.initiate(
      { reference: payment.reference, amountPaisa: payment.amountPaisa, productName, returnUrl, failureUrl: `${returnUrl}&failed=1`, customer: { name: member.fullName, phone: member.phone, email: member.email } },
      provider.creds,
      provider.env,
    );
    if (res.providerRef) await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: res.providerRef } });
    return res;
  } catch (err) {
    log.error("payment.initiate_failed", { err, provider: provider.key, paymentId: payment.id });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Could not reach the payment provider" } });
    throw new AppError(502, "provider_error", "Payment couldn't be started. Please try again.");
  }
}

// ─────────────────────────────── Verification & idempotent processing ───────────────────────────────

/** Browser return from a provider: re-verified server-side with the provider before anything changes. */
export async function handleProviderReturn(providerKey: string, query: URLSearchParams) {
  const reference = query.get("ref") ?? query.get("purchase_order_id") ?? "";
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment || payment.provider !== providerKey) throw notFound("Payment not found.");
  const provider = await providerFor(payment.gymId, providerKey);
  let evt: VerifiedEvent;
  try {
    evt = await provider.adapter.verifyReturn(query, provider.creds, provider.env, { reference, amountPaisa: payment.amountPaisa, providerRef: payment.providerRef });
  } catch (err) {
    if (err instanceof VerificationError) {
      await securityEvent({ type: "PAYMENT_VERIFICATION_FAILED", actorType: "SYSTEM", gymId: payment.gymId, details: { provider: providerKey, reference, reason: err.message } });
    }
    throw err;
  }
  return applyVerifiedEvent(providerKey, evt, payment.gymId);
}

/** Server-to-server webhook. Signature is verified before the body is trusted. */
export async function handleWebhook(providerKey: string, rawBody: string, headers: Headers) {
  const adapter = PAYMENT_ADAPTERS[providerKey];
  if (!adapter?.verifyWebhook) throw notFound();
  let evt: VerifiedEvent;
  try {
    evt = await adapter.verifyWebhook(rawBody, headers, {});
  } catch (err) {
    await securityEvent({ type: "WEBHOOK_SIGNATURE_INVALID", actorType: "SYSTEM", details: { provider: providerKey, reason: (err as Error).message } });
    await prisma.paymentWebhookEvent
      .create({ data: { provider: providerKey, eventId: `invalid:${randomToken(8)}`, signatureValid: false, status: "REJECTED", error: (err as Error).message, payload: { length: rawBody.length } } })
      .catch(() => undefined);
    throw new AppError(401, "invalid_signature", "Invalid signature");
  }
  const payment = await prisma.payment.findUnique({ where: { reference: evt.reference } });
  return applyVerifiedEvent(providerKey, evt, payment?.gymId ?? null);
}

export async function applyVerifiedEvent(providerKey: string, evt: VerifiedEvent, gymId: string | null) {
  // 1. Idempotency: each provider event is processed once.
  let eventRow;
  try {
    eventRow = await prisma.paymentWebhookEvent.create({
      data: { provider: providerKey, eventId: evt.eventId, gymId, signatureValid: true, status: "RECEIVED", payload: evt.raw as never },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const prior = await prisma.paymentWebhookEvent.update({ where: { provider_eventId: { provider: providerKey, eventId: evt.eventId } }, data: { attempts: { increment: 1 } } });
      const payment = await prisma.payment.findUnique({ where: { reference: evt.reference } });
      return { duplicate: true, status: prior.status, payment };
    }
    throw err;
  }

  const payment = await prisma.payment.findUnique({ where: { reference: evt.reference } });
  const finish = (status: string, error?: string) =>
    prisma.paymentWebhookEvent.update({ where: { id: eventRow.id }, data: { status, error, processedAt: new Date(), paymentId: payment?.id } });

  // 2. Transaction checks: known payment, same provider, same tenant, exact amount.
  if (!payment) {
    await finish("UNKNOWN_PAYMENT");
    return { duplicate: false, status: "UNKNOWN_PAYMENT", payment: null };
  }
  if (payment.provider !== providerKey || (gymId && payment.gymId !== gymId)) {
    await finish("REJECTED", "Provider or tenant mismatch");
    await securityEvent({ type: "PAYMENT_TENANT_MISMATCH", actorType: "SYSTEM", gymId: payment.gymId, details: { providerKey, reference: evt.reference } });
    return { duplicate: false, status: "REJECTED", payment };
  }
  if (evt.status === "SUCCEEDED" && evt.amountPaisa !== null && evt.amountPaisa !== payment.amountPaisa) {
    await finish("AMOUNT_MISMATCH", `Expected ${payment.amountPaisa}, got ${evt.amountPaisa}`);
    await securityEvent({ type: "PAYMENT_AMOUNT_MISMATCH", actorType: "SYSTEM", gymId: payment.gymId, details: { reference: evt.reference, expected: payment.amountPaisa, received: evt.amountPaisa } });
    return { duplicate: false, status: "AMOUNT_MISMATCH", payment };
  }
  if (evt.status === "PENDING") {
    await finish("PENDING");
    return { duplicate: false, status: "PENDING", payment };
  }

  const result = evt.status === "SUCCEEDED" ? await confirmPayment(payment.id, evt.providerRef) : await failPayment(payment.id, "Payment was not completed");
  await finish(result.changed ? "PROCESSED" : "NO_CHANGE");
  return { duplicate: false, status: evt.status, payment: result.payment };
}

/** Locks the payment row, then transitions PENDING → SUCCEEDED exactly once and fulfils it. */
export async function confirmPayment(paymentId: string, providerRef?: string, actor?: AuditActor) {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === "SUCCEEDED") return { payment: p, changed: false as const };
    if (p.status === "REFUNDED") return { payment: p, changed: false as const };
    // Serialise fulfilment per member / per order: two payments confirming at once must not both read the same
    // "latest membership" (overlapping memberships) or both fulfil one order.
    if (p.purpose === "MEMBERSHIP" && p.memberId) await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${p.memberId} FOR UPDATE`;
    const order = p.orderId ? (await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "MarketplaceOrder" WHERE "id" = ${p.orderId} FOR UPDATE`)[0] : undefined;
    const paid = await tx.payment.update({ where: { id: p.id }, data: { status: "SUCCEEDED", paidAt: new Date(), providerRef: providerRef ?? p.providerRef, failureReason: null } });
    if (order?.status === "PAID" || order?.status === "FULFILLED") {
      // The customer paid a second checkout attempt for an order another attempt already paid. Keep the money on
      // record, don't fulfil twice, and flag it for a refund.
      await tx.auditLog.create({ data: { actorType: "SYSTEM", action: "payment.duplicate_order_payment", entityType: "Payment", entityId: p.id, gymId: p.gymId, metadata: { orderId: p.orderId, amountPaisa: p.amountPaisa, note: "Refund needed" } } });
      return { payment: paid, changed: false as const };
    }
    if (order?.status === "CANCELLED") {
      // Paid after the order timed out and released its stock: fulfil it (the money is taken) but flag the stock.
      await tx.auditLog.create({ data: { actorType: "SYSTEM", action: "payment.paid_after_cancel", entityType: "Payment", entityId: p.id, gymId: p.gymId, metadata: { orderId: p.orderId, note: "Stock was released; check availability" } } });
    }
    const fulfilment = await fulfil(tx, paid);
    return { payment: paid, changed: true as const, fulfilment };
  }, MONEY_TX);

  if (outcome.changed) {
    const p = outcome.payment;
    const gym = await prisma.gym.findUniqueOrThrow({ where: { id: p.gymId } });
    if (p.memberId) {
      await notify({
        gymId: p.gymId,
        memberId: p.memberId,
        channel: "IN_APP",
        category: "PAYMENT",
        template: "PAYMENT_RECEIVED",
        vars: { amount: formatMoney(p.amountPaisa, gym.currencySymbol), description: p.purpose === "MEMBERSHIP" ? "your membership" : "your order", receiptNumber: outcome.fulfilment?.receiptNumber },
        link: `/app/receipts/${p.id}`,
        dedupeKey: `payment-received:${p.id}`,
      });
    }
    if (p.purpose === "MEMBERSHIP" && p.memberId) {
      await onMemberRenewed(p.gymId, p.memberId, p.paidAt ?? new Date());
      await enqueue("risk.recalculate", { gymId: p.gymId }, { gymId: p.gymId, idempotencyKey: `risk:${p.gymId}:${Math.floor(Date.now() / 600_000)}` });
    }
    if (p.purpose === "MARKETPLACE_ORDER" && p.orderId) await onMarketplacePurchase(p.gymId, p.orderId);
    if (actor) await audit({ actor, action: "payment.confirmed", entityType: "Payment", entityId: p.id, gymId: p.gymId, after: { amountPaisa: p.amountPaisa, method: p.method } });
  }
  return outcome;
}

export async function failPayment(paymentId: string, reason: string) {
  const res = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== "PENDING") return { payment: p, changed: false };
    const failed = await tx.payment.update({ where: { id: p.id }, data: { status: "FAILED", failureReason: reason } });
    return { payment: failed, changed: true };
  }, MONEY_TX);
  if (res.changed) {
    const p = res.payment;
    if (p.purpose === "MEMBERSHIP") await releaseCouponReservation(prisma, { paymentId: p.id });
    // The order stays open while another checkout attempt for it is still pending (or already paid).
    if (p.orderId && !(await prisma.payment.count({ where: { orderId: p.orderId, id: { not: p.id }, status: { in: ["PENDING", "SUCCEEDED"] } } }))) {
      await releaseOrderInventory(p.gymId, p.orderId, "Payment failed");
    }
    await onPaymentFailed(p.gymId, p.id);
  }
  return res;
}

// ─────────────────────────────── Fulfilment ───────────────────────────────

/** R<yymmdd>-<ref>, dated in the gym's time zone so it matches the date printed on the receipt. */
export function receiptNumber(p: Pick<Payment, "paidAt" | "reference">, tz: string) {
  const d = localDate(p.paidAt ?? new Date(), tz).slice(2).replace(/-/g, "");
  return `R${d}-${p.reference.slice(-6)}`;
}

async function fulfil(tx: Tx, p: Payment) {
  const gym = await tx.gym.findUniqueOrThrow({ where: { id: p.gymId } });
  const number = receiptNumber(p, gym.timezone);
  if (p.purpose === "MEMBERSHIP") {
    if (!p.memberId || !p.planId) throw new Error("Membership payment missing member or plan");
    const plan = await tx.membershipPlan.findFirstOrThrow({ where: { id: p.planId, gymId: p.gymId } });
    const membership = await renewMembership(tx, p.gymId, p.memberId, p.planId, plan.pricePaisa, todayIn(gym.timezone), "MANUAL");
    await tx.payment.update({ where: { id: p.id }, data: { membershipId: membership.id } });
    await tx.invoice.create({
      data: {
        gymId: p.gymId,
        memberId: p.memberId,
        paymentId: p.id,
        number,
        totalPaisa: p.amountPaisa,
        lines: [
          { description: `${plan.name} membership (${membership.startDate.toISOString().slice(0, 10)} → ${membership.endDate.toISOString().slice(0, 10)})`, amountPaisa: plan.pricePaisa },
          ...(p.discountPaisa ? [{ description: "Discount", amountPaisa: -p.discountPaisa }] : []),
        ],
      },
    });
    // Revenue is booked gross and the discount as a negative contra line, so revenue + discount = cash taken.
    await tx.ledgerEntry.createMany({
      data: [
        { gymId: p.gymId, paymentId: p.id, account: "MEMBERSHIP_REVENUE", amountPaisa: p.amountPaisa + p.discountPaisa, description: `${plan.name} membership` },
        ...(p.discountPaisa ? [{ gymId: p.gymId, paymentId: p.id, account: "DISCOUNT" as const, amountPaisa: -p.discountPaisa, description: p.couponId ? "Coupon discount" : "Discount" }] : []),
      ],
    });
    if (p.couponId) await recordCouponRedemption(tx, p.couponId, p.memberId, p.id);
    return { receiptNumber: number, membershipId: membership.id };
  }

  // Marketplace order
  const order = await tx.marketplaceOrder.findUniqueOrThrow({ where: { id: p.orderId! }, include: { items: { include: { product: { include: { bundleItems: { include: { product: true } } } } } } } });
  await tx.marketplaceOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
  for (const item of order.items) {
    // A bundle books each service inside it; a plain service books itself.
    const services = item.product.isBundle
      ? item.product.bundleItems.filter((b) => b.product.kind === "SERVICE").map((b) => ({ product: b.product, title: `${b.product.name} (${item.name})`, times: b.quantity * item.quantity }))
      : item.kind === "SERVICE" ? [{ product: item.product, title: item.name, times: item.quantity }] : [];
    for (const s of services) {
      await tx.booking.create({
        data: {
          gymId: p.gymId,
          memberId: order.memberId,
          orderItemId: item.id,
          trainerId: s.product.trainerId,
          title: s.title,
          status: "PENDING",
          sessionsTotal: (s.product.sessionCount ?? 1) * s.times,
        },
      });
    }
  }
  const entries = [
    { account: "MARKETPLACE_GROSS" as const, amountPaisa: order.totalPaisa, description: `Order ${order.number}` },
    { account: "PLATFORM_COMMISSION" as const, amountPaisa: order.platformFeePaisa, description: `Platform commission — ${order.number}` },
    { account: "GYM_SHARE" as const, amountPaisa: order.gymSharePaisa, description: `Gym share — ${order.number}` },
  ];
  // Vendor payables are split per vendor (pro-rated on the discounted total, same as at order time)
  // so each vendor's balance is traceable; rounding goes to the last vendor so the sum is exact.
  const vendorItems = order.items.filter((i) => i.vendorId && i.vendorBps > 0);
  const perVendor = new Map<string, number>();
  vendorItems.forEach((i) => {
    const lineNet = Math.round(((i.unitPricePaisa * i.quantity) / order.subtotalPaisa) * order.totalPaisa);
    perVendor.set(i.vendorId!, (perVendor.get(i.vendorId!) ?? 0) + Math.round((lineNet * i.vendorBps) / 10_000));
  });
  const vendorIds = [...perVendor.keys()];
  const drift = order.vendorSharePaisa - [...perVendor.values()].reduce((a, b) => a + b, 0);
  if (vendorIds.length) perVendor.set(vendorIds.at(-1)!, perVendor.get(vendorIds.at(-1)!)! + drift);
  await tx.ledgerEntry.createMany({
    data: [
      ...entries.map((e) => ({ ...e, gymId: p.gymId, paymentId: p.id, orderId: order.id })),
      ...vendorIds.map((vendorId) => ({ gymId: p.gymId, paymentId: p.id, orderId: order.id, vendorId, account: "VENDOR_PAYABLE" as const, amountPaisa: perVendor.get(vendorId)!, description: `Vendor payable — ${order.number}` })),
    ],
  });
  await tx.invoice.create({
    data: {
      gymId: p.gymId,
      memberId: order.memberId,
      paymentId: p.id,
      number,
      totalPaisa: order.totalPaisa,
      lines: [
        ...order.items.map((i) => ({ description: `${i.name} × ${i.quantity}`, amountPaisa: i.unitPricePaisa * i.quantity })),
        ...(order.discountPaisa ? [{ description: "Discount", amountPaisa: -order.discountPaisa }] : []),
      ],
    },
  });
  if (p.couponId) await recordCouponRedemption(tx, p.couponId, order.memberId, p.id, order.id);
  return { receiptNumber: number, orderId: order.id };
}

// ─────────────────────────────── Staff-recorded payments ───────────────────────────────

/** Cash / bank / POS payment taken at the front desk. Recorded by an authorised staff member and audited. */
export async function recordManualMembershipPayment(
  gym: Gym,
  input: {
    memberId: string;
    planId: string;
    method: Exclude<PaymentMethod, "ONLINE" | "IMPORTED">;
    amountPaisa?: number;
    note?: string;
    /** One key per payment form: resubmitting it (double-click, retry after a timeout) returns the first payment. */
    idempotencyKey?: string;
    /** Staff confirmed they really are taking a second payment for the same member and plan within a minute. */
    confirmDuplicate?: boolean;
  },
  actor: AuditActor,
) {
  const db = tenantDb(gym.id);
  const [member, plan] = await Promise.all([
    db.member.findUnique({ where: { id: input.memberId } }),
    db.membershipPlan.findFirst({ where: { id: input.planId } }),
  ]);
  if (!member) throw notFound("Member not found.");
  if (!plan) throw notFound("Plan not found.");
  await assertCanActivateMember(gym, member);
  const amount = input.amountPaisa ?? plan.pricePaisa;
  if (amount < 0 || amount > plan.pricePaisa) throw badRequest("Amount must be between 0 and the plan price.");

  // Under the member's row lock: an earlier submit of this form wins, and a near-identical payment taken moments ago
  // needs confirmation. Both checks and the insert are atomic, so concurrent submits can't slip past each other.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${member.id} AND "gymId" = ${gym.id} FOR UPDATE`;
    if (input.idempotencyKey) {
      const prior = await tx.payment.findFirst({ where: { gymId: gym.id, idempotencyKey: input.idempotencyKey } });
      if (prior) {
        if (prior.memberId !== member.id || prior.planId !== plan.id) throw new AppError(409, "idempotency_conflict", "This form was already used for a different payment. Reload and try again.");
        return { payment: prior, replay: true };
      }
    }
    if (!input.confirmDuplicate) {
      const recent = await tx.payment.findFirst({
        where: { gymId: gym.id, memberId: member.id, planId: plan.id, method: { notIn: ["ONLINE", "IMPORTED"] }, status: { in: ["PENDING", "SUCCEEDED"] }, createdAt: { gte: new Date(Date.now() - 60_000) } },
      });
      if (recent) {
        throw new AppError(409, "duplicate_payment", `A ${plan.name} payment for ${member.fullName} was recorded less than a minute ago. Record another one only if you really took a second payment.`, { paymentId: recent.id });
      }
    }
    const payment = await tx.payment.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        purpose: "MEMBERSHIP",
        method: input.method,
        provider: null,
        reference: newReference(),
        amountPaisa: amount,
        discountPaisa: plan.pricePaisa - amount,
        planId: plan.id,
        status: "PENDING",
        recordedById: actor.id ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    return { payment, replay: false };
  }, MONEY_TX);
  // A replayed submit returns the original payment; confirming again is a no-op once it has succeeded.
  if (created.replay) return (await confirmPayment(created.payment.id)).payment;
  const payment = created.payment;
  let res;
  try {
    res = await confirmPayment(payment.id, undefined, actor);
  } catch (err) {
    // Confirmation runs in its own locked transaction; if it fails (e.g. a second submit of the same payment lost
    // the race to renew this membership), close this row as FAILED so no PENDING payment is left behind.
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Not applied: the membership was renewed by another payment at the same moment." } }).catch(() => undefined);
    throw err;
  }
  await audit({ actor, action: "payment.recorded_manual", entityType: "Payment", entityId: payment.id, gymId: gym.id, after: { memberId: member.id, planId: plan.id, amountPaisa: amount, method: input.method, note: input.note } });
  return res.payment;
}

const RECONCILE_AFTER_MS = 2 * 3_600_000;
const GIVE_UP_AFTER_MS = 48 * 3_600_000;

/**
 * Online payments still pending after 2 hours. A member who paid and closed the tab never comes back through the
 * return URL, so each one is checked with its provider first: completed payments are confirmed, declined ones failed.
 * Ones the provider still reports as pending (or can't be reached for) are retried on later runs and only failed
 * after 48 hours, with an audit entry so an admin can re-verify. Test-gateway payments have no provider to ask.
 */
export async function expireStalePayments() {
  const stale = await prisma.payment.findMany({ where: { status: "PENDING", method: "ONLINE", createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_MS) } }, select: { id: true, provider: true, gymId: true, createdAt: true } });
  const out = { confirmed: 0, failed: 0, stillPending: 0 };
  for (const p of stale) {
    if (!p.provider || p.provider === "sandbox") {
      await failPayment(p.id, "Payment was not completed in time");
      out.failed++;
      continue;
    }
    let status: string;
    try {
      const res = await reverifyPayment(p.id);
      status = res.payment?.status === "SUCCEEDED" ? "SUCCEEDED" : res.payment?.status === "FAILED" ? "FAILED" : "PENDING";
    } catch (err) {
      log.warn("payment.reconcile_failed", { err, paymentId: p.id, provider: p.provider });
      status = "PENDING";
    }
    if (status === "SUCCEEDED") out.confirmed++;
    else if (status === "FAILED") out.failed++;
    else if (Date.now() - p.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      await failPayment(p.id, "Not confirmed by the payment provider within 48 hours");
      await prisma.auditLog.create({ data: { actorType: "SYSTEM", action: "payment.unconfirmed_timeout", entityType: "Payment", entityId: p.id, gymId: p.gymId, metadata: { provider: p.provider, note: "Re-verify with the provider if the member says they paid" } } });
      out.failed++;
    } else out.stillPending++;
  }
  return out;
}

/** Asks the provider for the payment's current status and applies it (used by reconciliation and admin retries). */
export async function reverifyPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.provider) throw notFound("Payment not found.");
  if (payment.provider === "sandbox") throw badRequest("Test-gateway payments can't be re-verified.");
  const provider = await providerFor(payment.gymId, payment.provider);
  const query = new URLSearchParams(payment.providerRef ? { pidx: payment.providerRef } : {});
  const evt = await provider.adapter.verifyReturn(query, provider.creds, provider.env, { reference: payment.reference, amountPaisa: payment.amountPaisa, providerRef: payment.providerRef });
  return applyVerifiedEvent(payment.provider, { ...evt, eventId: `${evt.eventId}:reverify:${Date.now()}` }, payment.gymId);
}
