import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { applyBps } from "@/lib/money";
import { log } from "@/lib/logger";
import { randomToken } from "@/lib/crypto";
import type { Gym, Member } from "@/generated/prisma/client";
import { applyCoupon, releaseCouponReservation, reserveCoupon } from "./coupons";

export type Split = { platformBps: number; gymBps: number; vendorBps: number; ruleId: string | null };

/**
 * Commission split for a listing. Most specific active rule wins:
 * PROMOTION → VENDOR → CATEGORY → GYM → PLATFORM_DEFAULT, then by rule priority.
 * For a gym's own listing (no vendor), the vendor share folds into the gym share.
 */
export async function resolveCommission(input: { gymId: string; categoryId: string; vendorId: string | null; at?: Date }): Promise<Split> {
  const at = input.at ?? new Date();
  const rules = await prisma.commissionRule.findMany({
    where: {
      active: true,
      AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: at } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: at } }] }],
      OR: [
        { scope: "PLATFORM_DEFAULT" },
        { scope: "GYM", gymId: input.gymId },
        { scope: "CATEGORY", categoryId: input.categoryId },
        ...(input.vendorId ? [{ scope: "VENDOR" as const, vendorId: input.vendorId }] : []),
        { scope: "PROMOTION", OR: [{ gymId: input.gymId }, { gymId: null }], AND: [{ OR: [{ categoryId: null }, { categoryId: input.categoryId }] }] },
      ],
    },
  });
  const rank = { PROMOTION: 5, VENDOR: 4, CATEGORY: 3, GYM: 2, PLATFORM_DEFAULT: 1 } as const;
  const best = rules.sort((a, b) => rank[b.scope] - rank[a.scope] || b.priority - a.priority)[0];
  if (!best) {
    log.warn("commission.no_rule", { gymId: input.gymId });
    return { platformBps: 0, gymBps: 10_000, vendorBps: 0, ruleId: null };
  }
  if (!input.vendorId) return { platformBps: best.platformBps, gymBps: best.gymBps + best.vendorBps, vendorBps: 0, ruleId: best.id };
  return { platformBps: best.platformBps, gymBps: best.gymBps, vendorBps: best.vendorBps, ruleId: best.id };
}

/** Splits an amount so the three parts always sum exactly to the total (rounding goes to the gym). */
export function splitAmount(total: number, s: Pick<Split, "platformBps" | "vendorBps">) {
  const platform = applyBps(total, s.platformBps);
  const vendor = applyBps(total, s.vendorBps);
  return { platform, vendor, gym: total - platform - vendor };
}

/**
 * A bundle is a listing made of the gym's own listings. Its stock and "bought separately" price
 * are derived from its items, so neither is accepted from the client. Items are fixed once
 * created: stock released on cancellation must go back to exactly what was reserved.
 */
export async function createBundle(
  gymId: string,
  input: { name: string; description?: string | null; categoryId: string; pricePaisa: number; items: { productId: string; quantity: number }[]; featured?: boolean; status?: "DRAFT" | "ACTIVE" },
) {
  const ids = input.items.map((i) => i.productId);
  if (input.items.length < 2 || input.items.length > 8) throw badRequest("A bundle needs between 2 and 8 items.");
  if (new Set(ids).size !== ids.length) throw badRequest("Each item can only be added once — set its quantity instead.");
  if (input.items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10)) throw badRequest("Item quantities must be between 1 and 10.");
  const category = await prisma.marketplaceCategory.findFirst({ where: { id: input.categoryId, active: true } });
  if (!category) throw badRequest("Choose a category.");
  const db = tenantDb(gymId);
  const parts = await db.marketplaceProduct.findMany({ where: { id: { in: ids }, isBundle: false, vendorId: null, status: { in: ["ACTIVE", "DRAFT"] } } });
  if (parts.length !== ids.length) throw badRequest("Bundles can only include this gym's own listings that aren't archived or bundles themselves.");
  const separately = input.items.reduce((a, i) => a + parts.find((p) => p.id === i.productId)!.pricePaisa * i.quantity, 0);
  if (input.pricePaisa >= separately) throw badRequest(`A bundle must cost less than buying its items separately (${(separately / 100).toLocaleString("en-IN")}).`);
  return prisma.$transaction(async (tx) => {
    const bundle = await tx.marketplaceProduct.create({
      data: {
        gymId, categoryId: category.id, kind: category.kind, isBundle: true, name: input.name, description: input.description ?? null,
        pricePaisa: input.pricePaisa, compareAtPaisa: separately, inventory: null, featured: input.featured ?? false, status: input.status ?? "ACTIVE",
      },
    });
    await tx.bundleItem.createMany({ data: input.items.map((i) => ({ bundleId: bundle.id, productId: i.productId, quantity: i.quantity })) });
    return bundle;
  });
}

/** How many of a bundle can be sold right now: limited by its scarcest stocked item. null = unlimited. */
export function bundleAvailability(items: { quantity: number; product: { inventory: number | null } }[]) {
  const caps = items.filter((i) => i.product.inventory !== null).map((i) => Math.floor(i.product.inventory! / i.quantity));
  return caps.length ? Math.max(0, Math.min(...caps)) : null;
}

/** Stock movements for an order line: the listing itself, or each item of a bundle. */
function stockMoves(p: { id: string; inventory: number | null; isBundle: boolean; name: string; bundleItems: { quantity: number; product: { id: string; inventory: number | null; name: string } }[] }, quantity: number) {
  if (!p.isBundle) return p.inventory === null ? [] : [{ id: p.id, name: p.name, qty: quantity }];
  return p.bundleItems.filter((b) => b.product.inventory !== null).map((b) => ({ id: b.product.id, name: b.product.name, qty: b.quantity * quantity }));
}

/**
 * Places an order and reserves inventory atomically (conditional decrement). Reserved stock is
 * released if payment fails or the order expires unpaid.
 */
export async function placeOrder(gym: Gym, member: Member, items: { productId: string; quantity: number }[], couponCode?: string | null) {
  if (!items.length) throw badRequest("Your cart is empty.");
  const db = tenantDb(gym.id);
  const products = await db.marketplaceProduct.findMany({ where: { id: { in: items.map((i) => i.productId) }, status: "ACTIVE" }, include: { bundleItems: { include: { product: true } } } });
  if (products.length !== new Set(items.map((i) => i.productId)).size) throw badRequest("One of those items is no longer available.");

  if (products.some((p) => p.isBundle && (p.bundleItems.length === 0 || p.bundleItems.some((b) => b.product.status === "ARCHIVED")))) throw badRequest("One of those items is no longer available.");

  const lines: { p: (typeof products)[number]; quantity: number; split: Split }[] = [];
  for (const i of items) {
    const p = products.find((x) => x.id === i.productId)!;
    if (i.quantity < 1 || i.quantity > 20) throw badRequest("Invalid quantity.");
    const split = await resolveCommission({ gymId: gym.id, categoryId: p.categoryId, vendorId: p.vendorId });
    lines.push({ p, quantity: i.quantity, split });
  }
  const subtotal = lines.reduce((a, l) => a + l.p.pricePaisa * l.quantity, 0);
  const discount = couponCode ? await applyCoupon(gym.id, member.id, couponCode, "MARKETPLACE", subtotal) : null;
  const total = subtotal - (discount?.discountPaisa ?? 0);
  if (total <= 0) throw badRequest("Order total must be greater than zero.");

  // Commission is computed on the discounted amount, pro-rated per line.
  let platformFee = 0, vendorShare = 0;
  for (const l of lines) {
    const lineNet = Math.round(((l.p.pricePaisa * l.quantity) / subtotal) * total);
    const s = splitAmount(lineNet, l.split);
    platformFee += s.platform;
    vendorShare += s.vendor;
  }
  const gymShare = total - platformFee - vendorShare;

  return prisma.$transaction(async (tx) => {
    for (const l of lines) {
      for (const m of stockMoves(l.p, l.quantity)) {
        const n = await tx.$executeRaw`UPDATE "MarketplaceProduct" SET "inventory" = "inventory" - ${m.qty} WHERE "id" = ${m.id} AND "gymId" = ${gym.id} AND "inventory" >= ${m.qty}`;
        if (n === 0) throw conflict(l.p.isBundle ? `${l.p.name} is out of stock (${m.name}).` : `${l.p.name} is out of stock.`);
      }
    }
    const number = `ORD-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomToken(4).replace(/[-_]/g, "X").toUpperCase()}`;
    const order = await tx.marketplaceOrder.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        number,
        subtotalPaisa: subtotal,
        discountPaisa: discount?.discountPaisa ?? 0,
        totalPaisa: total,
        couponId: discount?.couponId,
        platformFeePaisa: platformFee,
        gymSharePaisa: gymShare,
        vendorSharePaisa: vendorShare,
      },
    });
    await tx.orderItem.createMany({
      data: lines.map((l) => ({
        gymId: gym.id,
        orderId: order.id,
        productId: l.p.id,
        vendorId: l.p.vendorId,
        name: l.p.name,
        kind: l.p.kind,
        unitPricePaisa: l.p.pricePaisa,
        quantity: l.quantity,
        platformBps: l.split.platformBps,
        gymBps: l.split.gymBps,
        vendorBps: l.split.vendorBps,
      })),
    });
    if (discount) await reserveCoupon(tx, discount.couponId, member.id, { orderId: order.id });
    return order;
  });
}

export async function releaseOrderInventory(gymId: string, orderId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MarketplaceOrder" WHERE "id" = ${orderId} AND "gymId" = ${gymId} FOR UPDATE`;
    const order = await tx.marketplaceOrder.findFirst({ where: { id: orderId, gymId }, include: { items: { include: { product: { include: { bundleItems: { include: { product: true } } } } } } } });
    if (!order || order.status !== "PENDING_PAYMENT") return;
    for (const i of order.items) {
      for (const m of stockMoves(i.product, i.quantity)) {
        await tx.$executeRaw`UPDATE "MarketplaceProduct" SET "inventory" = "inventory" + ${m.qty} WHERE "id" = ${m.id} AND "gymId" = ${gymId} AND "inventory" IS NOT NULL`;
      }
    }
    await tx.marketplaceOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await releaseCouponReservation(tx, { orderId: order.id });
    await tx.auditLog.create({ data: { actorType: "SYSTEM", action: "order.cancelled", entityType: "MarketplaceOrder", entityId: order.id, gymId, metadata: { reason } } });
  });
}

/** Unpaid orders older than 30 minutes release their stock. */
export async function expireUnpaidOrders() {
  const stale = await prisma.marketplaceOrder.findMany({
    where: { status: "PENDING_PAYMENT", placedAt: { lt: new Date(Date.now() - 30 * 60_000) }, payments: { none: {} } },
    select: { id: true, gymId: true },
  });
  for (const o of stale) await releaseOrderInventory(o.gymId, o.id, "Unpaid order expired");
  return { released: stale.length };
}

/**
 * Honest contextual suggestion: only services the gym has marked as suggestible at the
 * member's streak level. Never a countdown, fake scarcity or pre-ticked add-on.
 */
export async function contextualSuggestion(gymId: string, streak: number) {
  const p = await tenantDb(gymId).marketplaceProduct.findFirst({
    where: { status: "ACTIVE", suggestAtStreak: { not: null, lte: streak } },
    orderBy: [{ suggestAtStreak: "desc" }, { featured: "desc" }],
  });
  if (!p) return null;
  return { product: p, message: `You're on a ${streak}-day streak. If you'd like to take your progress further, ${p.name} is available.` };
}

export async function fulfilOrder(gymId: string, orderId: string) {
  const db = tenantDb(gymId);
  const order = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound();
  if (order.status !== "PAID") throw badRequest("Only paid orders can be marked fulfilled.");
  return db.marketplaceOrder.update({ where: { id: orderId }, data: { status: "FULFILLED", fulfilledAt: new Date() } });
}
