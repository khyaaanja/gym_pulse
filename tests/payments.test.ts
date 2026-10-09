import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { encryptJson } from "@/lib/crypto";
import * as svc from "@/services/payments/service";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";
import { placeOrder } from "@/services/marketplace";
import { deskActor, ensureSandboxProvider, makeCoupon, makeGym, makeMember, makeProduct } from "./helpers/fixtures";

beforeAll(async () => {
  process.env.ENABLE_TEST_GATEWAY = "true";
  await ensureSandboxProvider();
});
afterEach(() => vi.restoreAllMocks());

const statuses = (r: PromiseSettledResult<unknown>[]) => r.map((x) => x.status);

describe("coupons are reserved at checkout", () => {
  it("a per-member limit of 1 can't be used by two checkouts started before either is paid", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const coupon = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const first = await svc.startMembershipCheckout(gym, member, { planId: plan.id, provider: "sandbox", couponCode: coupon.code });
    await expect(svc.startMembershipCheckout(gym, member, { planId: plan.id, provider: "sandbox", couponCode: coupon.code })).rejects.toThrow(/already used/i);
    await svc.confirmPayment(first.payment.id);
    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
  });

  it("a total cap holds when two members check out concurrently", async () => {
    const { gym, plan } = await makeGym();
    const [a, b] = await Promise.all([makeMember(gym.id), makeMember(gym.id)]);
    const coupon = await makeCoupon(gym.id, { maxRedemptions: 1, perMemberLimit: 5 });
    const res = await Promise.allSettled([a, b].map((m) => svc.startMembershipCheckout(gym, m, { planId: plan.id, provider: "sandbox", couponCode: coupon.code })));
    expect(statuses(res).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("a failed payment gives the coupon back", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const coupon = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const first = await svc.startMembershipCheckout(gym, member, { planId: plan.id, provider: "sandbox", couponCode: coupon.code });
    await svc.failPayment(first.payment.id, "declined");
    const second = await svc.startMembershipCheckout(gym, member, { planId: plan.id, provider: "sandbox", couponCode: coupon.code });
    await svc.confirmPayment(second.payment.id);
    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redemptions).toBe(1);
  });

  it("a marketplace order's coupon is reserved too", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    const product = await makeProduct(gym.id);
    const coupon = await makeCoupon(gym.id, { perMemberLimit: 1 });
    await placeOrder(gym, member, [{ productId: product.id, quantity: 1 }], coupon.code);
    await expect(placeOrder(gym, member, [{ productId: product.id, quantity: 1 }], coupon.code)).rejects.toThrow(/already used/i);
  });
});

describe("desk payments are idempotent", () => {
  it("the same idempotency key submitted twice at once records one payment", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const input = { memberId: member.id, planId: plan.id, method: "CASH" as const, idempotencyKey: "desk-key-1" };
    const res = await Promise.allSettled([svc.recordManualMembershipPayment(gym, input, deskActor), svc.recordManualMembershipPayment(gym, input, deskActor)]);
    expect(statuses(res)).toEqual(["fulfilled", "fulfilled"]);
    const ids = res.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(ids[0]).toBe(ids[1]);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("the same key submitted again later returns the first payment", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const input = { memberId: member.id, planId: plan.id, method: "CASH" as const, idempotencyKey: "desk-key-2" };
    const first = await svc.recordManualMembershipPayment(gym, input, deskActor);
    const again = await svc.recordManualMembershipPayment(gym, input, deskActor);
    expect(again.id).toBe(first.id);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("a second payment for the same member and plan within a minute needs explicit confirmation", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await svc.recordManualMembershipPayment(gym, { memberId: member.id, planId: plan.id, method: "CASH" }, deskActor);
    await expect(svc.recordManualMembershipPayment(gym, { memberId: member.id, planId: plan.id, method: "CASH" }, deskActor)).rejects.toMatchObject({ code: "duplicate_payment" });
    await svc.recordManualMembershipPayment(gym, { memberId: member.id, planId: plan.id, method: "CASH", confirmDuplicate: true }, deskActor);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(2);
  });

  it("concurrent renewals for a brand-new member never produce overlapping memberships", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await Promise.allSettled([1, 2].map((i) => svc.recordManualMembershipPayment(gym, { memberId: member.id, planId: plan.id, method: "CASH", idempotencyKey: `k${i}`, confirmDuplicate: true }, deskActor)));
    const ms = await prisma.membership.findMany({ where: { memberId: member.id }, orderBy: { startDate: "asc" } });
    for (let i = 1; i < ms.length; i++) expect(ms[i]!.startDate.getTime()).toBeGreaterThan(ms[i - 1]!.endDate.getTime());
  });
});

describe("marketplace orders keep every payment attempt", () => {
  it("starting checkout again keeps the first attempt's reference resolvable", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    const product = await makeProduct(gym.id);
    const order = await placeOrder(gym, member, [{ productId: product.id, quantity: 1 }]);
    const a = await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    const b = await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    expect(b.payment.id).not.toBe(a.payment.id);
    expect(await prisma.payment.findUnique({ where: { reference: a.payment.reference } })).not.toBeNull();
  });

  it("paying the first attempt after a second was started fulfils the order once", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    const product = await makeProduct(gym.id);
    const order = await placeOrder(gym, member, [{ productId: product.id, quantity: 1 }]);
    const a = await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    const b = await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    await svc.confirmPayment(a.payment.id);
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    // The customer pays the second attempt too: recorded, flagged for refund, not fulfilled twice.
    await svc.confirmPayment(b.payment.id);
    expect(await prisma.ledgerEntry.count({ where: { orderId: order.id, account: "MARKETPLACE_GROSS" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "payment.duplicate_order_payment", entityId: b.payment.id } })).toBe(1);
  });

  it("one attempt failing doesn't cancel the order while another attempt is still open", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    const product = await makeProduct(gym.id);
    const order = await placeOrder(gym, member, [{ productId: product.id, quantity: 1 }]);
    const a = await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    await svc.startOrderCheckout(gym, member, order.id, "sandbox");
    await svc.failPayment(a.payment.id, "declined");
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
  });
});

describe("stale online payments are reconciled with the provider before failing", () => {
  async function esewaGym() {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    if (!(await prisma.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: "esewa" } }))) {
      await prisma.paymentProviderConfig.create({ data: { providerKey: "esewa", displayName: "eSewa", enabled: true, methods: ["wallet"] } });
    }
    await prisma.paymentProviderConfig.create({ data: { gymId: gym.id, providerKey: "esewa", displayName: "eSewa", enabled: true, methods: ["wallet"], environment: "SANDBOX", credentialsEnc: encryptJson({ productCode: "EPAYTEST", secretKey: "x" }) } });
    const payment = await prisma.payment.create({ data: { gymId: gym.id, memberId: member.id, purpose: "MEMBERSHIP", method: "ONLINE", provider: "esewa", reference: `GP-T-${Date.now()}-${Math.random()}`, amountPaisa: plan.pricePaisa, planId: plan.id, status: "PENDING", createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    return { gym, member, payment };
  }

  it("a payment the provider says completed is confirmed, not failed", async () => {
    const { member, payment } = await esewaGym();
    vi.spyOn(PAYMENT_ADAPTERS.esewa!, "verifyReturn").mockResolvedValue({ eventId: `e-${payment.id}`, reference: payment.reference, status: "SUCCEEDED", amountPaisa: payment.amountPaisa, raw: {} });
    await svc.expireStalePayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("a payment the provider can't be reached for stays pending", async () => {
    const { payment } = await esewaGym();
    vi.spyOn(PAYMENT_ADAPTERS.esewa!, "verifyReturn").mockRejectedValue(new Error("network down"));
    await svc.expireStalePayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("a payment the provider reports as not completed is failed", async () => {
    const { payment } = await esewaGym();
    vi.spyOn(PAYMENT_ADAPTERS.esewa!, "verifyReturn").mockResolvedValue({ eventId: `f-${payment.id}`, reference: payment.reference, status: "FAILED", amountPaisa: null, raw: {} });
    await svc.expireStalePayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");
  });
});

describe("the test gateway is opt-in", () => {
  it("isn't offered unless ENABLE_TEST_GATEWAY=true", async () => {
    const { gym } = await makeGym();
    process.env.ENABLE_TEST_GATEWAY = "false";
    try {
      expect((await svc.availableProviders(gym.id)).map((p) => p.key)).not.toContain("sandbox");
    } finally {
      process.env.ENABLE_TEST_GATEWAY = "true";
    }
    expect((await svc.availableProviders(gym.id)).map((p) => p.key)).toContain("sandbox");
  });

  it("is never offered in production, even when enabled", async () => {
    const { gym } = await makeGym();
    process.env.APP_ENV = "production";
    try {
      expect((await svc.availableProviders(gym.id)).map((p) => p.key)).not.toContain("sandbox");
    } finally {
      process.env.APP_ENV = "test";
    }
  });
});

describe("money transactions have headroom when the database is slow", () => {
  it("confirming a payment survives a 6.5 s wait on a lock inside its transaction (Prisma's default limit is 5 s)", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const payment = await prisma.payment.create({ data: { gymId: gym.id, memberId: member.id, purpose: "MEMBERSHIP", method: "CASH", provider: "manual", reference: `GP-T-${Date.now()}-${Math.random()}`, amountPaisa: plan.pricePaisa, planId: plan.id, status: "PENDING" } });

    // Another connection holds the member's row lock. confirmPayment takes the payment lock first, then waits on
    // the member lock, so the wait is spent inside its transaction, as it was when the desk hit a slow database.
    const { schema } = (await import("./setup/env")).loadTestEnv();
    const blocker = new (await import("pg")).default.Client({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT "id" FROM "Member" WHERE "id" = $1 FOR UPDATE`, [member.id]);
      const release = new Promise((r) => setTimeout(r, 6_500)).then(() => blocker.query("COMMIT"));
      const started = Date.now();
      await svc.confirmPayment(payment.id, undefined, deskActor);
      await release;
      expect(Date.now() - started).toBeGreaterThan(6_000);
    } finally {
      await blocker.end();
    }
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
  }, 30_000);
});

describe("receipt numbers", () => {
  it("are dated in the gym's time zone, matching the date printed on the receipt", () => {
    // 20:00 UTC on 1 Oct is 01:45 on 2 Oct in Kathmandu.
    const p = { paidAt: new Date("2026-10-01T20:00:00Z"), reference: "GP-XYZ-ABC123" };
    expect(svc.receiptNumber(p, "Asia/Kathmandu")).toBe("R261002-ABC123");
    expect(svc.receiptNumber(p, "UTC")).toBe("R261001-ABC123");
  });
});
