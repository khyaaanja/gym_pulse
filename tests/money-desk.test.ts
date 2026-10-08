import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { addDays, today } from "@/lib/time";
import { errCode, json, params, req, signInMember, signInStaff, signOut } from "./helpers/route";
import { makeGym, makeMember, ensureSandboxProvider } from "./helpers/fixtures";
import { ds, giveMembership, sumLedger } from "./helpers/money";

const { POST: deskPay } = await import("@/app/api/gym/payments/manual/route");

beforeAll(async () => {
  process.env.ENABLE_TEST_GATEWAY = "true";
  await ensureSandboxProvider();
});
beforeEach(() => signOut());

const TZ = "Asia/Kathmandu";
const pay = (body: Record<string, unknown>) => deskPay(req("/api/gym/payments/manual", { body: { method: "CASH", ...body } }), params());
const memberships = (memberId: string) => prisma.membership.findMany({ where: { memberId }, orderBy: { startDate: "asc" } });

async function setup() {
  const { gym, plan } = await makeGym();
  const member = await makeMember(gym.id);
  await signInStaff(gym.id, "OWNER");
  return { gym, plan, member };
}

describe("desk payment authorisation", () => {
  it("anonymous callers get 401 and nothing is written", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const res = await pay({ memberId: member.id, planId: plan.id });
    expect(res.status).toBe(401);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it.each(["STAFF", "MANAGER", "TRAINER"] as const)("%s cannot record payments (403) and no payment/membership is created", async (role) => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await signInStaff(gym.id, role);
    const res = await pay({ memberId: member.id, planId: plan.id });
    expect(res.status).toBe(403);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("a member login cannot use the desk endpoint", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await signInMember(gym.id, member.id);
    const res = await pay({ memberId: member.id, planId: plan.id });
    expect([401, 403]).toContain(res.status);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("an owner of another gym can't pay for this gym's member or plan (404, nothing written)", async () => {
    const a = await makeGym();
    const memberA = await makeMember(a.gym.id);
    const b = await makeGym();
    await signInStaff(b.gym.id, "OWNER");
    expect((await pay({ memberId: memberA.id, planId: b.plan.id })).status).toBe(404);
    const memberB = await makeMember(b.gym.id);
    expect((await pay({ memberId: memberB.id, planId: a.plan.id })).status).toBe(404);
    expect(await prisma.payment.count({ where: { memberId: { in: [memberA.id, memberB.id] } } })).toBe(0);
  });

  it("a gymId in the body is ignored: the payment lands in the caller's gym", async () => {
    const { gym, plan, member } = await setup();
    const other = await makeGym();
    const res = await pay({ memberId: member.id, planId: plan.id, gymId: other.gym.id });
    expect(res.status).toBe(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    expect(p.gymId).toBe(gym.id);
    expect(await prisma.payment.count({ where: { gymId: other.gym.id } })).toBe(0);
  });
});

describe("desk renewal dates", () => {
  it("a brand-new member starts today and runs durationDays (inclusive)", async () => {
    const { gym, plan, member } = await setup();
    expect((await pay({ memberId: member.id, planId: plan.id })).status).toBe(200);
    const [m] = await memberships(member.id);
    expect(ds(m!.startDate)).toBe(today(gym.timezone));
    expect(ds(m!.endDate)).toBe(addDays(today(gym.timezone), plan.durationDays - 1));
    expect(m!.isRenewal).toBe(false);
    expect(m!.status).toBe("ACTIVE");
  });

  it("renewing while still active extends from the day after expiry (no days lost)", async () => {
    const { gym, plan, member } = await setup();
    const old = await giveMembership(gym.id, member.id, plan.id, -20, 10);
    expect((await pay({ memberId: member.id, planId: plan.id })).status).toBe(200);
    const ms = await memberships(member.id);
    expect(ms).toHaveLength(2);
    const next = ms[1]!;
    expect(ds(next.startDate)).toBe(addDays(today(TZ), 11));
    expect(ds(next.endDate)).toBe(addDays(today(TZ), 11 + plan.durationDays - 1));
    expect(next.isRenewal).toBe(true);
    expect(next.renewedFromId).toBe(old.id);
  });

  it("a membership ending today is still 'active': renewal starts tomorrow", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -29, 0);
    await pay({ memberId: member.id, planId: plan.id });
    const ms = await memberships(member.id);
    expect(ds(ms[1]!.startDate)).toBe(addDays(today(TZ), 1));
  });

  it("a lapsed member (ended yesterday) restarts from today, not from the old end date", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -30, -1, TZ, "EXPIRED");
    await pay({ memberId: member.id, planId: plan.id });
    const ms = await memberships(member.id);
    expect(ms).toHaveLength(2);
    expect(ds(ms[1]!.startDate)).toBe(today(TZ));
    expect(ds(ms[1]!.endDate)).toBe(addDays(today(TZ), plan.durationDays - 1));
  });

  it("a long-lapsed member also restarts from today", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -200, -170, TZ, "EXPIRED");
    await pay({ memberId: member.id, planId: plan.id });
    expect(ds((await memberships(member.id))[1]!.startDate)).toBe(today(TZ));
  });

  it("two sequential renewals chain without overlap or gaps", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -5, 5);
    await pay({ memberId: member.id, planId: plan.id });
    await pay({ memberId: member.id, planId: plan.id, confirmDuplicate: true });
    const ms = await memberships(member.id);
    expect(ms).toHaveLength(3);
    for (let i = 1; i < ms.length; i++) expect(ds(ms[i]!.startDate)).toBe(addDays(ds(ms[i - 1]!.endDate), 1));
    expect(ms[2]!.renewedFromId).toBe(ms[1]!.id);
  });

  it("renewal stamps the plan price on the membership, not the amount paid", async () => {
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id, amountRupees: 1000 });
    expect((await memberships(member.id))[0]!.pricePaisa).toBe(plan.pricePaisa);
  });
});

describe("desk payment amounts, receipts and ledger", () => {
  it("records full price by default: payment, invoice and ledger agree", async () => {
    const { gym, plan, member } = await setup();
    const res = await pay({ memberId: member.id, planId: plan.id });
    const { paymentId } = (await json<{ data?: { paymentId: string }; paymentId?: string }>(res)) as never as { paymentId: string };
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id }, include: { invoice: true } });
    expect(paymentId ?? p.id).toBe(p.id);
    expect(p).toMatchObject({ status: "SUCCEEDED", method: "CASH", amountPaisa: plan.pricePaisa, discountPaisa: 0, gymId: gym.id });
    expect(p.paidAt).not.toBeNull();
    expect(p.invoice!.totalPaisa).toBe(plan.pricePaisa);
    expect(await sumLedger({ paymentId: p.id }, "MEMBERSHIP_REVENUE")).toBe(plan.pricePaisa);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: p.id } })).toBe(1);
  });

  it("a partial amount is recorded with the difference as discount; revenue is booked gross with a DISCOUNT contra line", async () => {
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id, amountRupees: 1000 });
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    expect(p.amountPaisa).toBe(100_000);
    expect(p.discountPaisa).toBe(plan.pricePaisa - 100_000);
    expect(await sumLedger({ paymentId: p.id }, "MEMBERSHIP_REVENUE")).toBe(plan.pricePaisa);
    expect(await sumLedger({ paymentId: p.id }, "DISCOUNT")).toBe(-(plan.pricePaisa - 100_000));
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: p.id, account: "DISCOUNT" } })).description).toBe("Discount");
  });

  it("net ledger (revenue + discount lines) for a discounted desk payment equals the cash taken", async () => {
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id, amountRupees: 1000 });
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    const net = (await sumLedger({ paymentId: p.id }, "MEMBERSHIP_REVENUE")) + (await sumLedger({ paymentId: p.id }, "DISCOUNT"));
    expect(p.discountPaisa).toBeGreaterThan(0);
    expect(net).toBe(p.amountPaisa);
  });

  it("platform finance reports membership money net of discounts (cash taken), not gross", async () => {
    const { platformFinance } = await import("@/services/platform-finance");
    const thisMonth = async () => (await platformFinance(1)).series.at(-1)!.membership;
    const before = await thisMonth();
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id, amountRupees: 1000 });
    expect(await thisMonth()).toBe(before + 100_000);
    expect(plan.pricePaisa).toBeGreaterThan(100_000);
  });

  it("an amount above the plan price is refused (400) and nothing is recorded", async () => {
    const { plan, member } = await setup();
    const res = await pay({ memberId: member.id, planId: plan.id, amountRupees: plan.pricePaisa / 100 + 1 });
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { gymId: plan.gymId } })).toBe(0);
  });

  it("a negative amount or bad method is rejected by validation", async () => {
    const { plan, member } = await setup();
    expect((await pay({ memberId: member.id, planId: plan.id, amountRupees: -5 })).status).toBe(400);
    expect((await pay({ memberId: member.id, planId: plan.id, method: "ONLINE" })).status).toBe(400);
    expect((await pay({ memberId: member.id, planId: plan.id, method: "IMPORTED" })).status).toBe(400);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("every desk payment gets its own receipt number, unique within the gym, and exactly one invoice", async () => {
    const { gym, plan } = await setup();
    const members = await Promise.all([1, 2, 3, 4, 5].map(() => makeMember(gym.id)));
    for (const m of members) expect((await pay({ memberId: m.id, planId: plan.id })).status).toBe(200);
    const invoices = await prisma.invoice.findMany({ where: { gymId: gym.id } });
    expect(invoices).toHaveLength(5);
    expect(new Set(invoices.map((i) => i.number)).size).toBe(5);
    for (const i of invoices) expect(i.number).toMatch(/^R\d{6}-/);
  });

  it("receipts issued concurrently for one gym stay unique", async () => {
    const { gym, plan } = await setup();
    const members = await Promise.all(Array.from({ length: 6 }, () => makeMember(gym.id)));
    const res = await Promise.all(members.map((m) => pay({ memberId: m.id, planId: plan.id })));
    expect(res.map((r) => r.status)).toEqual(Array(6).fill(200));
    const nums = (await prisma.invoice.findMany({ where: { gymId: gym.id } })).map((i) => i.number);
    expect(nums).toHaveLength(6);
    expect(new Set(nums).size).toBe(6);
  });

  it("the audit log names the desk payment", async () => {
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id, note: "cash at desk" });
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    expect(await prisma.auditLog.count({ where: { action: "payment.recorded_manual", entityId: p.id } })).toBe(1);
  });
});

describe("concurrent and repeated desk payments", () => {
  it("the same idempotency key submitted twice at once extends once, books one ledger entry, one invoice", async () => {
    const { plan, member } = await setup();
    const body = { memberId: member.id, planId: plan.id, idempotencyKey: "idem-key-concurrent-1" };
    const res = await Promise.all([pay(body), pay(body)]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const ids = await Promise.all(res.map(async (r) => ((await json<Record<string, unknown>>(r)) as { paymentId?: string; data?: { paymentId?: string } })));
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(1);
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(1);
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: member.id } });
    expect(await prisma.ledgerEntry.count({ where: { paymentId: p.id } })).toBe(1);
    expect(await prisma.invoice.count({ where: { paymentId: p.id } })).toBe(1);
    expect(ids.length).toBe(2);
  });

  it("an idempotent replay after an active renewal does not push the end date again", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -5, 5);
    const body = { memberId: member.id, planId: plan.id, idempotencyKey: "idem-key-replay-1" };
    await pay(body);
    const after1 = await memberships(member.id);
    await pay(body);
    await pay(body);
    const after3 = await memberships(member.id);
    expect(after3.map((m) => m.id)).toEqual(after1.map((m) => m.id));
    expect(after3).toHaveLength(2);
  });

  it("the same key reused for a different plan is refused with 409 idempotency_conflict", async () => {
    const { gym, plan, member } = await setup();
    const plan2 = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Quarterly", durationDays: 90, pricePaisa: 400_000, active: true } });
    await pay({ memberId: member.id, planId: plan.id, idempotencyKey: "idem-key-conflict-1" });
    const res = await pay({ memberId: member.id, planId: plan2.id, idempotencyKey: "idem-key-conflict-1" });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("idempotency_conflict");
    expect(await memberships(member.id)).toHaveLength(1);
  });

  it("the same key in a different gym is independent (keys are per gym)", async () => {
    const a = await setup();
    await pay({ memberId: a.member.id, planId: a.plan.id, idempotencyKey: "idem-key-shared-1" });
    const b = await setup();
    const res = await pay({ memberId: b.member.id, planId: b.plan.id, idempotencyKey: "idem-key-shared-1" });
    expect(res.status).toBe(200);
    expect(await prisma.membership.count({ where: { memberId: b.member.id } })).toBe(1);
  });

  it("an immediate second payment without confirmation is 409 duplicate_payment and changes nothing", async () => {
    const { plan, member } = await setup();
    await pay({ memberId: member.id, planId: plan.id });
    const res = await pay({ memberId: member.id, planId: plan.id });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("duplicate_payment");
    expect(await memberships(member.id)).toHaveLength(1);
    expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("two concurrent unkeyed payments: exactly one wins, one membership, one ledger entry", async () => {
    const { plan, member } = await setup();
    const res = await Promise.all([pay({ memberId: member.id, planId: plan.id }), pay({ memberId: member.id, planId: plan.id })]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await memberships(member.id)).toHaveLength(1);
    expect(await prisma.payment.count({ where: { memberId: member.id, status: "SUCCEEDED" } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { gymId: plan.gymId } })).toBe(1);
  });

  it("two concurrent confirmed renewals on an active member produce contiguous, non-overlapping periods", async () => {
    const { gym, plan, member } = await setup();
    await giveMembership(gym.id, member.id, plan.id, -5, 5);
    const res = await Promise.all([1, 2].map((i) => pay({ memberId: member.id, planId: plan.id, confirmDuplicate: true, idempotencyKey: `idem-concurrent-${i}-x` })));
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const ms = await memberships(member.id);
    expect(ms).toHaveLength(3);
    for (let i = 1; i < ms.length; i++) expect(ds(ms[i]!.startDate)).toBe(addDays(ds(ms[i - 1]!.endDate), 1));
    expect(await prisma.membership.count({ where: { renewedFromId: { in: ms.map((m) => m.id) } } })).toBe(2);
  });
});
