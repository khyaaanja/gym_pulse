import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { signSandboxWebhook } from "@/services/payments/providers";
import { errCode, json, params, req, signInMember, signOut } from "./helpers/route";
import { makeCoupon, makeGym, makeMember, ensureSandboxProvider } from "./helpers/fixtures";
import { giveMembership, sumLedger } from "./helpers/money";

const { POST: renew } = await import("@/app/api/me/renew/route");
const { POST: webhook } = await import("@/app/api/webhooks/payments/[provider]/route");
const { POST: couponQuote } = await import("@/app/api/me/coupon/route");

beforeAll(async () => {
  process.env.ENABLE_TEST_GATEWAY = "true";
  await ensureSandboxProvider();
});
beforeEach(() => signOut());

const unwrap = <T>(b: unknown) => ((b as { data?: T }).data ?? b) as T;
async function memberCtx() {
  const { gym, plan } = await makeGym();
  const member = await makeMember(gym.id);
  await signInMember(gym.id, member.id);
  return { gym, plan, member };
}
const startRenew = async (body: Record<string, unknown>) => renew(req("/api/me/renew", { body: { provider: "sandbox", ...body } }), params());
const send = (event: Record<string, unknown>, sig?: string) => {
  const raw = JSON.stringify(event);
  return webhook(
    new NextRequest("http://localhost:3000/api/webhooks/payments/sandbox", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-gympulse-signature": sig ?? signSandboxWebhook(raw), "x-forwarded-for": "10.55.0.1" } }),
    params({ provider: "sandbox" }),
  );
};
const evt = (p: { reference: string; amountPaisa: number }, over: Record<string, unknown> = {}) => ({ id: `evt-${Math.random().toString(36).slice(2)}`, reference: p.reference, status: "SUCCEEDED", amountPaisa: p.amountPaisa, ...over });

async function started(body: Record<string, unknown> = {}) {
  const c = await memberCtx();
  const res = await startRenew({ planId: c.plan.id, ...body });
  expect(res.status).toBe(200);
  const out = unwrap<{ paymentId: string; reference: string }>(await json(res));
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: out.paymentId } });
  return { ...c, payment };
}

describe("member online renewal", () => {
  it("starting checkout creates a PENDING payment at the plan price and no membership yet", async () => {
    const { plan, member, payment } = await started();
    expect(payment).toMatchObject({ status: "PENDING", amountPaisa: plan.pricePaisa, purpose: "MEMBERSHIP", method: "ONLINE", provider: "sandbox" });
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  it("a client-sent amount is ignored: the payment amount comes from the plan", async () => {
    const { plan, payment } = await started({ amountPaisa: 1, pricePaisa: 1, amount: 1 });
    expect(payment.amountPaisa).toBe(plan.pricePaisa);
  });

  it("anonymous callers get 401; unknown provider 400; unknown plan 404; inactive plan 404", async () => {
    const { gym, plan } = await makeGym();
    expect((await startRenew({ planId: plan.id })).status).toBe(401);
    const m = await makeMember(gym.id);
    await signInMember(gym.id, m.id);
    expect((await startRenew({ planId: plan.id, provider: "esewa" })).status).toBe(400);
    expect((await startRenew({ planId: "nope" })).status).toBe(404);
    const dead = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Old", durationDays: 30, pricePaisa: 1000, active: false } });
    expect((await startRenew({ planId: dead.id })).status).toBe(404);
    expect(await prisma.payment.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("a plan of another gym can't be bought", async () => {
    const { member } = await memberCtx();
    const other = await makeGym();
    expect((await startRenew({ planId: other.plan.id })).status).toBe(404);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("the sandbox is refused when the test gateway is disabled", async () => {
    const { gym, plan } = await makeGym();
    const m = await makeMember(gym.id);
    await signInMember(gym.id, m.id);
    process.env.ENABLE_TEST_GATEWAY = "false";
    try {
      const res = await startRenew({ planId: plan.id });
      expect(res.status).toBe(400);
      expect(await errCode(res)).toBe("provider_unavailable");
    } finally {
      process.env.ENABLE_TEST_GATEWAY = "true";
    }
    expect(await prisma.payment.count({ where: { memberId: m.id } })).toBe(0);
  });
});

describe("signed webhook", () => {
  it("a valid signed success confirms the payment: membership, invoice and ledger appear once", async () => {
    const { payment, member, plan } = await started();
    const res = await send(evt(payment));
    expect(res.status).toBe(200);
    expect(unwrap<{ status: string; duplicate: boolean }>(await json(res))).toMatchObject({ duplicate: false });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { invoice: true } });
    expect(p.status).toBe("SUCCEEDED");
    expect(p.invoice).not.toBeNull();
    expect(await prisma.membership.count({ where: { memberId: member.id, status: "ACTIVE" } })).toBe(1);
    expect(await sumLedger({ paymentId: payment.id }, "MEMBERSHIP_REVENUE")).toBe(plan.pricePaisa);
  });

  it("a bad signature is rejected 401 and the payment stays pending", async () => {
    const { payment, member } = await started();
    const res = await send(evt(payment), "deadbeef");
    expect(res.status).toBe(401);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("a signature computed for a different body (tampered amount) is rejected", async () => {
    const { payment } = await started();
    const signed = JSON.stringify(evt(payment));
    const tampered = JSON.stringify({ ...JSON.parse(signed), reference: payment.reference + "x" });
    const res = await send(JSON.parse(tampered), signSandboxWebhook(signed));
    expect(res.status).toBe(401);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("an amount mismatch is rejected: payment not confirmed, no membership, event marked AMOUNT_MISMATCH", async () => {
    const { payment, member } = await started();
    const e = evt(payment, { amountPaisa: payment.amountPaisa - 1 });
    const res = await send(e);
    expect(res.status).toBe(200);
    expect(unwrap<{ status: string }>(await json(res)).status).toBe("AMOUNT_MISMATCH");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);
    expect((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "sandbox", eventId: e.id } } })).status).toBe("AMOUNT_MISMATCH");
  });

  it("an overpayment amount is rejected too", async () => {
    const { payment } = await started();
    await send(evt(payment, { amountPaisa: payment.amountPaisa + 100 }));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("a replayed webhook (same event id) is idempotent: one membership, one invoice, one ledger entry", async () => {
    const { payment, member } = await started();
    const e = evt(payment);
    const first = await send(e);
    const second = await send(e);
    const third = await send(e);
    expect(unwrap<{ duplicate: boolean }>(await json(first)).duplicate).toBe(false);
    expect(unwrap<{ duplicate: boolean }>(await json(second)).duplicate).toBe(true);
    expect(unwrap<{ duplicate: boolean }>(await json(third)).duplicate).toBe(true);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.invoice.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "sandbox", eventId: e.id } } })).attempts).toBeGreaterThanOrEqual(2);
  });

  it("the same payment delivered under two different event ids still fulfils once", async () => {
    const { payment, member } = await started();
    await send(evt(payment));
    await send(evt(payment));
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("concurrent identical webhooks fulfil exactly once", async () => {
    const { payment, member } = await started();
    const e = evt(payment);
    const res = await Promise.allSettled([send(e), send(e), send(e)]);
    expect(res.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.invoice.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("concurrent distinct-event webhooks for one payment fulfil exactly once", async () => {
    const { payment, member } = await started();
    await Promise.allSettled([send(evt(payment)), send(evt(payment)), send(evt(payment))]);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("a FAILED event fails the payment and creates no membership", async () => {
    const { payment, member } = await started();
    await send(evt(payment, { status: "FAILED" }));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("FAILED");
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("an unknown reference is recorded UNKNOWN_PAYMENT and changes nothing", async () => {
    const e = evt({ reference: "GP-NOPE", amountPaisa: 100 });
    const res = await send(e);
    expect(res.status).toBe(200);
    expect(unwrap<{ status: string }>(await json(res)).status).toBe("UNKNOWN_PAYMENT");
  });

  it("an unknown provider key is 404", async () => {
    const res = await webhook(req("/api/webhooks/payments/nope", { body: {} }), params({ provider: "nope" }));
    expect(res.status).toBe(404);
  });

  it("a gym-level renewal for an active member extends from expiry via the online path too", async () => {
    const { gym, plan, member, payment } = await started();
    await giveMembership(gym.id, member.id, plan.id, -5, 5);
    await send(evt(payment));
    const ms = await prisma.membership.findMany({ where: { memberId: member.id }, orderBy: { startDate: "asc" } });
    expect(ms).toHaveLength(2);
    expect(ms[1]!.startDate.getTime() - ms[0]!.endDate.getTime()).toBe(86_400_000);
  });
});

describe("coupons", () => {
  const quote = (code: string, amountPaisa = 100_000, scope = "MEMBERSHIP") => couponQuote(req("/api/me/coupon", { body: { code, scope, amountPaisa } }), params());

  it("quotes a percent coupon (50%) on the amount, case-insensitively", async () => {
    const { gym } = await memberCtx();
    const c = await makeCoupon(gym.id);
    const res = await quote(c.code.toLowerCase(), 100_000);
    expect(res.status).toBe(200);
    expect(unwrap<{ discountPaisa: number }>(await json(res)).discountPaisa).toBe(50_000);
  });

  it("unknown, expired, inactive, not-yet-active and wrong-scope coupons are refused (400)", async () => {
    const { gym } = await memberCtx();
    const past = new Date(Date.now() - 86_400_000), future = new Date(Date.now() + 86_400_000);
    const expired = await makeCoupon(gym.id);
    await prisma.coupon.update({ where: { id: expired.id }, data: { validUntil: past } });
    const inactive = await makeCoupon(gym.id);
    await prisma.coupon.update({ where: { id: inactive.id }, data: { active: false } });
    const early = await makeCoupon(gym.id);
    await prisma.coupon.update({ where: { id: early.id }, data: { validFrom: future } });
    const market = await makeCoupon(gym.id);
    await prisma.coupon.update({ where: { id: market.id }, data: { appliesTo: "MARKETPLACE" } });
    for (const code of ["NOSUCHCODE", expired.code, inactive.code, early.code]) expect((await quote(code)).status).toBe(400);
    expect((await quote(market.code, 1000, "MEMBERSHIP")).status).toBe(400);
    expect((await quote(market.code, 1000, "MARKETPLACE")).status).toBe(200);
  });

  it("another gym's coupon is not valid here", async () => {
    await memberCtx();
    const other = await makeGym();
    const c = await makeCoupon(other.gym.id);
    expect((await quote(c.code)).status).toBe(400);
  });

  it("a per-member limit of 1 refuses the second checkout; checkout reserves the coupon at the discounted amount", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const first = await startRenew({ planId: plan.id, couponCode: c.code });
    expect(first.status).toBe(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    expect(p.amountPaisa).toBe(plan.pricePaisa / 2);
    expect(p.discountPaisa).toBe(plan.pricePaisa / 2);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id, memberId: member.id } })).toBe(1);
    const second = await startRenew({ planId: plan.id, couponCode: c.code });
    expect(second.status).toBe(400);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(1);
    // and the quote endpoint now says the same
    expect((await quote(c.code)).status).toBe(400);
  });

  it("per-member limit of 2 allows exactly two reservations", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await makeCoupon(gym.id, { perMemberLimit: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await startRenew({ planId: plan.id, couponCode: c.code })).status);
    expect(codes).toEqual([200, 200, 400]);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id, memberId: member.id } })).toBe(2);
  });

  it("concurrent checkouts by one member with a per-member limit of 1: exactly one succeeds", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const res = await Promise.all([1, 2, 3].map(() => startRenew({ planId: plan.id, couponCode: c.code })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { memberId: member.id, couponId: c.id } })).toBeGreaterThanOrEqual(1);
  });

  it("max redemptions of 1: a second member is refused once the first has reserved", async () => {
    const { gym, plan } = await makeGym();
    const c = await makeCoupon(gym.id, { maxRedemptions: 1, perMemberLimit: 5 });
    const a = await makeMember(gym.id), b = await makeMember(gym.id);
    await signInMember(gym.id, a.id);
    expect((await startRenew({ planId: plan.id, couponCode: c.code })).status).toBe(200);
    signOut();
    await signInMember(gym.id, b.id);
    const res = await startRenew({ planId: plan.id, couponCode: c.code });
    expect(res.status).toBe(400);
    expect((await quote(c.code)).status).toBe(400);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
  });

  it("paying with a coupon books gross revenue less a DISCOUNT line (net = cash), bumps the redemption counter once even on webhook replay", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    await startRenew({ planId: plan.id, couponCode: c.code });
    const payment = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    const e = evt(payment);
    await send(e);
    await send(e);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).redemptions).toBe(1);
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.amountPaisa).toBe(plan.pricePaisa / 2);
    expect(await sumLedger({ paymentId: payment.id }, "MEMBERSHIP_REVENUE")).toBe(plan.pricePaisa);
    expect(await sumLedger({ paymentId: payment.id }, "DISCOUNT")).toBe(-plan.pricePaisa / 2);
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: payment.id, account: "DISCOUNT" } })).description).toBe("Coupon discount");
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
  });

  it("a failed payment webhook releases the coupon so the member can retry", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    await startRenew({ planId: plan.id, couponCode: c.code });
    const payment = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    await send(evt(payment, { status: "FAILED" }));
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect((await startRenew({ planId: plan.id, couponCode: c.code })).status).toBe(200);
  });

  it("a 100% coupon can't waive an online payment entirely", async () => {
    const { gym, plan, member } = await memberCtx();
    const c = await prisma.coupon.create({ data: { gymId: gym.id, code: `FREE${Date.now()}`, kind: "PERCENT", value: 10_000, appliesTo: "ALL", perMemberLimit: 1 } });
    const res = await startRenew({ planId: plan.id, couponCode: c.code });
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("the coupon quote needs a signed-in member", async () => {
    expect((await quote("ANYCODE")).status).toBe(401);
  });
});
