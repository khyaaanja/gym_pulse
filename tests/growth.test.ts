import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { randomToken, sha256 } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { makeGym, makeMember } from "./helpers/fixtures";

// Route wrappers read the session cookie through next/headers; each test controls the token. Cookies the routes
// set (a new session after joining) land in `jar.set`.
const jar = vi.hoisted(() => ({ user: "", set: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "gp_session" && jar.user ? { name, value: jar.user } : undefined),
    set: (name: string, value: string) => void jar.set.set(name, value),
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));

const { POST: join } = await import("@/app/api/public/gyms/[slug]/join/route");
const { POST: enquire } = await import("@/app/api/public/gyms/[slug]/leads/route");
const { GET: listLeads, POST: logLead } = await import("@/app/api/gym/leads/route");
const { POST: convert } = await import("@/app/api/gym/leads/[id]/convert/route");
const { PATCH: patchLead } = await import("@/app/api/gym/leads/[id]/route");
const { POST: createPromo } = await import("@/app/api/gym/promotions/route");
const { PATCH: patchPromo } = await import("@/app/api/gym/promotions/[id]/route");
const { GET: listDiet, POST: diet } = await import("@/app/api/gym/diet-plans/route");
const { PATCH: patchDiet } = await import("@/app/api/gym/diet-plans/[id]/route");
const { POST: starter } = await import("@/app/api/gym/diet-plans/starter/route");
const { ensureReferralCode, publicGym } = await import("@/services/growth");
const { PATCH: patchSettings } = await import("@/app/api/gym/settings/route");

const PASSWORD = "Join-Password-42";
let ip = 0;
/** Each request comes from its own address so the per-IP limits of the public routes don't couple tests. */
const req = (path: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://localhost:3000${path}`, body === undefined && method === "GET" ? { headers: { "x-forwarded-for": `10.9.${ip >> 8}.${ip++ & 255}` } } : { method, body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": `10.9.${ip >> 8}.${ip++ & 255}` } });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const errCode = async (res: Response) => (await json<{ error?: { code?: string } }>(res)).error?.code;
const email = (tag: string) => `${tag}-${randomToken(6)}@example.test`.toLowerCase();
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function publicGymFixture(page: { enabled?: boolean; allowSelfSignup?: boolean } = {}) {
  const { gym, plan } = await makeGym();
  const settings = { publicPage: { enabled: page.enabled ?? true, allowSelfSignup: page.allowSelfSignup ?? true, listInDirectory: true, showPrices: true, amenities: [] } };
  return { gym: await prisma.gym.update({ where: { id: gym.id }, data: { settings } }), plan };
}

async function signIn(userId: string, gymId: string) {
  const token = randomToken();
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), activeGymId: gymId } });
  jar.user = token;
}

async function staff(gymId: string, role: "OWNER" | "MANAGER" | "STAFF" | "TRAINER") {
  const user = await prisma.user.create({ data: { name: `${role} person`, email: email(role.toLowerCase()), passwordHash: await hashPassword(PASSWORD) } });
  const s = await prisma.staffMember.create({ data: { gymId, userId: user.id, role } });
  await signIn(user.id, gymId);
  return { user, staff: s };
}

beforeEach(() => {
  jar.user = "";
  jar.set.clear();
});

describe("public gym page", () => {
  it("is visible only when the owner publishes it, and never for a suspended gym", async () => {
    const off = await publicGymFixture({ enabled: false });
    expect(await publicGym(off.gym.slug)).toBeNull();
    const on = await publicGymFixture();
    expect((await publicGym(on.gym.slug))?.id).toBe(on.gym.id);
    await prisma.gym.update({ where: { id: on.gym.id }, data: { status: "SUSPENDED" } });
    expect(await publicGym(on.gym.slug)).toBeNull();
  });
});

describe("joining a gym online", () => {
  it("creates an account and a self-signup member with no membership, then sends them to pay", async () => {
    const { gym, plan } = await publicGymFixture();
    const { user: owner } = await staff(gym.id, "OWNER");
    jar.user = "";
    const addr = email("joiner");
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Sita Joiner", email: addr, phone: "9812345678", password: PASSWORD, planId: plan.id }), params({ slug: gym.slug }));
    expect(res.status).toBe(200);
    const body = await json<{ redirect: string }>(res);
    expect(body.redirect).toContain("/app/renew?");
    expect(body.redirect).toContain(`plan=${plan.id}`);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
    const member = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, userId: user.id } });
    expect(member.source).toBe("SELF_SIGNUP");
    // Joining alone never grants gym access: no membership until they pay.
    expect(await prisma.membership.count({ where: { memberId: member.id } })).toBe(0);
    expect(jar.set.get("gp_session")).toBeTruthy();
    // The desk hears about it.
    expect(await prisma.notification.count({ where: { gymId: gym.id, category: "GROWTH", userId: owner.id, channel: "IN_APP" } })).toBe(1);
  });

  it("is refused when the owner hasn't turned online joining on", async () => {
    const { gym } = await publicGymFixture({ allowSelfSignup: false });
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "No Way", email: email("x"), password: PASSWORD }), params({ slug: gym.slug }));
    expect(res.status).toBe(403);
  });

  it("is a 404 for an unpublished gym", async () => {
    const { gym } = await publicGymFixture({ enabled: false });
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "No Way", email: email("x"), password: PASSWORD }), params({ slug: gym.slug }));
    expect(res.status).toBe(404);
  });

  it("asks an existing account to sign in instead of checking its password", async () => {
    const { gym } = await publicGymFixture();
    const addr = email("existing");
    await prisma.user.create({ data: { name: "Existing", email: addr, passwordHash: await hashPassword(PASSWORD) } });
    // Even the right password is not accepted here: this must not become a password-guessing oracle.
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Existing", email: addr, password: PASSWORD }), params({ slug: gym.slug }));
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("sign_in_required");
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("never links someone to an existing member record just because they typed its phone number", async () => {
    const { gym } = await publicGymFixture();
    const victim = await makeMember(gym.id);
    const victimPhone = phone();
    await prisma.member.update({ where: { id: victim.id }, data: { phone: victimPhone } });
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Impostor", email: email("imp"), phone: victimPhone, password: PASSWORD }), params({ slug: gym.slug }));
    expect(res.status).toBe(200);
    // The reply doesn't reveal the match…
    expect(JSON.stringify(await json(res))).not.toContain(victim.memberCode);
    // …the existing record stays unclaimed, and staff get a duplicate note on the new one.
    expect((await prisma.member.findUniqueOrThrow({ where: { id: victim.id } })).userId).toBeNull();
    const created = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, source: "SELF_SIGNUP" } });
    expect(created.notes).toContain(victim.memberCode);
  });

  it("lets a signed-in account join without a password, once", async () => {
    const { gym } = await publicGymFixture();
    const user = await prisma.user.create({ data: { name: "Signed In", email: email("si"), passwordHash: await hashPassword(PASSWORD) } });
    await signIn(user.id, gym.id);
    const first = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Signed In" }), params({ slug: gym.slug }));
    expect(first.status).toBe(200);
    const again = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Signed In" }), params({ slug: gym.slug }));
    expect((await json<{ redirect: string }>(again)).redirect).toBe("/app");
    expect(await prisma.member.count({ where: { gymId: gym.id, userId: user.id } })).toBe(1);
  });

  it("refuses the gym's own staff joining as a member", async () => {
    const { gym } = await publicGymFixture();
    await staff(gym.id, "STAFF");
    const res = await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Desk" }), params({ slug: gym.slug }));
    expect(res.status).toBe(400);
  });

  it("credits the referrer and the offer, but ignores codes and offers from another gym", async () => {
    const { gym } = await publicGymFixture();
    const other = await publicGymFixture();
    const referrer = await makeMember(gym.id);
    const code = await ensureReferralCode(tenantDb(gym.id), referrer);
    const foreign = await makeMember(other.gym.id);
    const foreignCode = await ensureReferralCode(tenantDb(other.gym.id), foreign);
    const promo = await prisma.gymPromotion.create({ data: { gymId: gym.id, title: "Dashain deal" } });
    const foreignPromo = await prisma.gymPromotion.create({ data: { gymId: other.gym.id, title: "Elsewhere" } });

    await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Friend One", email: email("f1"), password: PASSWORD, ref: code.toLowerCase(), promo: promo.id }), params({ slug: gym.slug }));
    const f1 = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, fullName: "Friend One" } });
    expect(f1.referredById).toBe(referrer.id);
    expect(f1.promotionId).toBe(promo.id);

    await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Friend Two", email: email("f2"), password: PASSWORD, ref: foreignCode, promo: foreignPromo.id }), params({ slug: gym.slug }));
    const f2 = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, fullName: "Friend Two" } });
    expect(f2.referredById).toBeNull();
    expect(f2.promotionId).toBeNull();
  });

  it("carries an offer's coupon to checkout and ignores an expired offer", async () => {
    const { gym, plan } = await publicGymFixture();
    const coupon = await prisma.coupon.create({ data: { gymId: gym.id, code: `DASHAIN${randomToken(2).toUpperCase().replace(/[^A-Z0-9]/g, "")}`, kind: "PERCENT", value: 2000 } });
    const live = await prisma.gymPromotion.create({ data: { gymId: gym.id, title: "Live", couponId: coupon.id, planId: plan.id } });
    const ended = await prisma.gymPromotion.create({ data: { gymId: gym.id, title: "Over", endsAt: new Date(Date.now() - 1000) } });
    const a = await json<{ redirect: string }>(await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Offer Taker", email: email("o1"), password: PASSWORD, promo: live.id }), params({ slug: gym.slug })));
    expect(a.redirect).toContain(`coupon=${coupon.code}`);
    expect(a.redirect).toContain(`plan=${plan.id}`);
    await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Late Taker", email: email("o2"), password: PASSWORD, promo: ended.id }), params({ slug: gym.slug }));
    expect((await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, fullName: "Late Taker" } })).promotionId).toBeNull();
  });
});

describe("enquiries (leads)", () => {
  it("records a free-trial request once per person and tells staff", async () => {
    const { gym } = await publicGymFixture();
    await staff(gym.id, "OWNER");
    jar.user = "";
    const p = phone();
    const first = await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Ram Lead", phone: p, message: "Evenings" }), params({ slug: gym.slug }));
    const second = await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Ram Lead", phone: p, message: "Mornings too" }), params({ slug: gym.slug }));
    // Same reply either way: nobody learns whether a number enquired before.
    expect(await json(first)).toEqual(await json(second));
    const leads = await prisma.lead.findMany({ where: { gymId: gym.id } });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.message).toBe("Evenings");
    expect(leads[0]!.notes).toContain("Mornings too");
    expect(await prisma.notification.count({ where: { gymId: gym.id, category: "GROWTH" } })).toBe(1);
  });

  it("needs a way to reach the person, and drops honeypot submissions silently", async () => {
    const { gym } = await publicGymFixture();
    expect((await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "No Contact" }), params({ slug: gym.slug }))).status).toBe(400);
    const bot = await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Bot", phone: phone(), website: "http://spam" }), params({ slug: gym.slug }));
    expect(bot.status).toBe(200);
    expect(await prisma.lead.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("is managed only by staff with leads.manage, and only for their own gym", async () => {
    const { gym } = await publicGymFixture();
    const other = await publicGymFixture();
    const foreignLead = await prisma.lead.create({ data: { gymId: other.gym.id, name: "Not yours", phone: phone() } });
    await staff(gym.id, "TRAINER");
    expect((await listLeads(req("/api/gym/leads", undefined, "GET"))).status).toBe(403);
    await staff(gym.id, "STAFF");
    expect((await listLeads(req("/api/gym/leads", undefined, "GET"))).status).toBe(200);
    // Another gym's lead id is simply not found here.
    expect((await patchLead(req(`/api/gym/leads/${foreignLead.id}`, { status: "LOST" }, "PATCH"), params({ id: foreignLead.id }))).status).toBe(404);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: foreignLead.id } })).status).toBe("NEW");
  });

  it("turns into exactly one member, even when converted twice at once", async () => {
    const { gym } = await publicGymFixture();
    const referrer = await makeMember(gym.id);
    await staff(gym.id, "MANAGER");
    const created = await json<{ id: string }>(await logLead(req("/api/gym/leads", { name: "Walk In", phone: phone(), source: "WALK_IN" })));
    await prisma.lead.update({ where: { id: created.id }, data: { referrerMemberId: referrer.id } });
    const results = await Promise.all([convert(req(`/api/gym/leads/${created.id}/convert`, {}), params({ id: created.id })), convert(req(`/api/gym/leads/${created.id}/convert`, {}), params({ id: created.id }))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: created.id } });
    expect(lead.status).toBe("CONVERTED");
    const member = await prisma.member.findUniqueOrThrow({ where: { id: lead.convertedMemberId! } });
    expect(member.referredById).toBe(referrer.id);
    expect(await prisma.member.count({ where: { gymId: gym.id, fullName: "Walk In" } })).toBe(1);
  });

  it("a repeat enquiry can't swap the contact details of someone else's enquiry", async () => {
    const { gym } = await publicGymFixture();
    const p = phone();
    await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Real Person", phone: p, message: "Hi" }), params({ slug: gym.slug }));
    await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Attacker", phone: p, email: email("attacker"), goal: "x", message: "changed" }), params({ slug: gym.slug }));
    const lead = await prisma.lead.findFirstOrThrow({ where: { gymId: gym.id } });
    expect(lead).toMatchObject({ name: "Real Person", phone: p, email: null, message: "Hi", goal: null });
  });

  it("joining online with a matching phone only notes the enquiry; staff confirm it", async () => {
    const { gym } = await publicGymFixture();
    const p = phone();
    await enquire(req(`/api/public/gyms/${gym.slug}/leads`, { name: "Comes Back", phone: p }), params({ slug: gym.slug }));
    await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Comes Back", email: email("cb"), phone: p, password: PASSWORD }), params({ slug: gym.slug }));
    const lead = await prisma.lead.findFirstOrThrow({ where: { gymId: gym.id } });
    expect(lead.status).toBe("NEW");
    expect(lead.notes).toContain("joined online");
  });

  it("unpaid online sign-ups don't use up the gym's member quota", async () => {
    const { gym } = await publicGymFixture();
    const { usage } = await import("@/lib/limits");
    const before = await usage(gym.id, "members", gym.timezone);
    await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Not Paid", email: email("np"), password: PASSWORD }), params({ slug: gym.slug }));
    expect(await usage(gym.id, "members", gym.timezone)).toBe(before);
    const m = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, fullName: "Not Paid" } });
    const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } });
    await prisma.membership.create({ data: { gymId: gym.id, memberId: m.id, planId: plan.id, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000), pricePaisa: plan.pricePaisa } });
    expect(await usage(gym.id, "members", gym.timezone)).toBe(before + 1);
  });
});

describe("member limit with online sign-ups", () => {
  it("is checked when an online sign-up first pays, online or at the desk", async () => {
    const { gym, plan } = await publicGymFixture();
    const tier = await prisma.saasPlan.create({ data: { key: `t-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`, name: "Tiny", pricePaisa: 0, memberLimit: 2 } });
    await prisma.gym.update({ where: { id: gym.id }, data: { planId: tier.id } });
    const paid = await makeMember(gym.id);
    await prisma.membership.create({ data: { gymId: gym.id, memberId: paid.id, planId: plan.id, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000), pricePaisa: plan.pricePaisa } });
    // Joining is allowed (unpaid sign-ups don't count)…
    expect((await join(req(`/api/public/gyms/${gym.slug}/join`, { name: "Over Limit", email: email("ol"), password: PASSWORD }), params({ slug: gym.slug }))).status).toBe(200);
    const m = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id, fullName: "Over Limit" } });
    // The desk fills the last seat meanwhile.
    const second = await makeMember(gym.id);
    await prisma.membership.create({ data: { gymId: gym.id, memberId: second.id, planId: plan.id, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000), pricePaisa: plan.pricePaisa } });
    const fresh = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
    // …but activating them would exceed the plan, both ways.
    const { startMembershipCheckout, recordManualMembershipPayment } = await import("@/services/payments/service");
    await expect(startMembershipCheckout(fresh, m, { planId: plan.id, provider: "sandbox" })).rejects.toMatchObject({ status: 402 });
    await expect(recordManualMembershipPayment(fresh, { memberId: m.id, planId: plan.id, method: "CASH" }, { type: "USER", id: null, name: "Desk", role: "OWNER", ip: null, userAgent: null })).rejects.toMatchObject({ status: 402 });
    expect(await prisma.membership.count({ where: { memberId: m.id } })).toBe(0);
  });
});

describe("offers", () => {
  it("refuse another gym's coupon or plan, and an end before the start", async () => {
    const { gym } = await publicGymFixture();
    const other = await publicGymFixture();
    const foreignCoupon = await prisma.coupon.create({ data: { gymId: other.gym.id, code: `X${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, "")}`, kind: "FIXED", value: 100 } });
    await staff(gym.id, "MANAGER");
    expect((await createPromo(req("/api/gym/promotions", { title: "Steal coupon", couponId: foreignCoupon.id }))).status).toBe(400);
    expect((await createPromo(req("/api/gym/promotions", { title: "Steal plan", planId: other.plan.id }))).status).toBe(400);
    expect((await createPromo(req("/api/gym/promotions", { title: "Backwards", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" }))).status).toBe(400);
    const ok = await createPromo(req("/api/gym/promotions", { title: "Tihar offer", endsAt: "2026-12-01T00:00:00.000Z" }));
    expect(ok.status).toBe(200);
    const promo = await json<{ id: string }>(ok);
    // An edit that sends only a start date is still checked against the stored end date.
    expect((await patchPromo(req(`/api/gym/promotions/${promo.id}`, { startsAt: "2027-01-01T00:00:00.000Z" }, "PATCH"), params({ id: promo.id }))).status).toBe(400);
    // …and an edit leaves fields it didn't mention alone.
    await patchPromo(req(`/api/gym/promotions/${promo.id}`, { badge: "20% OFF" }, "PATCH"), params({ id: promo.id }));
    const after = await prisma.gymPromotion.findUniqueOrThrow({ where: { id: promo.id } });
    expect(after.title).toBe("Tihar offer");
    expect(after.endsAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("are off-limits to front-desk staff by default", async () => {
    const { gym } = await publicGymFixture();
    await staff(gym.id, "STAFF");
    expect((await createPromo(req("/api/gym/promotions", { title: "Nope" }))).status).toBe(403);
  });
});

describe("gym settings", () => {
  it("saving one section leaves every other section as it was", async () => {
    const { gym } = await publicGymFixture();
    await prisma.gym.update({ where: { id: gym.id }, data: { settings: { ...(gym.settings as object), renewal: { reminderOffsetsDays: [10], gracePeriodDays: 2, channels: ["IN_APP"] } } } });
    await staff(gym.id, "OWNER");
    const res = await patchSettings(req("/api/gym/settings", { settings: { growth: { referralReward: "A free week each" } } }, "PATCH"));
    expect(res.status).toBe(200);
    const saved = (await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } })).settings as Record<string, { [k: string]: unknown }>;
    expect(saved.growth!.referralReward).toBe("A free week each");
    expect(saved.publicPage!.enabled).toBe(true);
    expect(saved.renewal!.reminderOffsetsDays).toEqual([10]);
  });
});

describe("referral codes", () => {
  it("are created once, even when requested concurrently", async () => {
    const { gym } = await makeGym();
    const m = await makeMember(gym.id);
    const db = tenantDb(gym.id);
    const codes = await Promise.all([ensureReferralCode(db, m), ensureReferralCode(db, m), ensureReferralCode(db, m)]);
    expect(new Set(codes).size).toBe(1);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).referralCode).toBe(codes[0]);
  });
});

describe("diet plans", () => {
  it("starter templates are added once", async () => {
    const { gym } = await makeGym();
    await staff(gym.id, "OWNER");
    const a = await json<{ added: number }>(await starter(req("/api/gym/diet-plans/starter", {})));
    const b = await json<{ added: number }>(await starter(req("/api/gym/diet-plans/starter", {})));
    expect(a.added).toBeGreaterThan(0);
    expect(b.added).toBe(0);
  });

  it("assigning copies the template and replaces the member's previous plan", async () => {
    const { gym } = await makeGym();
    const m = await makeMember(gym.id);
    await staff(gym.id, "OWNER");
    await starter(req("/api/gym/diet-plans/starter", {}));
    const [t1, t2] = await prisma.dietPlan.findMany({ where: { gymId: gym.id, isTemplate: true }, orderBy: { title: "asc" } });
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: m.id, templateId: t1!.id }))).status).toBe(200);
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: m.id, templateId: t2!.id }))).status).toBe(200);
    const plans = await prisma.dietPlan.findMany({ where: { memberId: m.id }, orderBy: { createdAt: "asc" } });
    expect(plans.map((p) => p.active)).toEqual([false, true]);
    expect(plans[1]!.title).toBe(t2!.title);
    // Later template edits don't change the member's copy.
    await prisma.dietPlan.update({ where: { id: t2!.id }, data: { title: "Renamed template" } });
    expect((await prisma.dietPlan.findUniqueOrThrow({ where: { id: plans[1]!.id } })).title).toBe(t2!.title);
  });

  it("trainers only see and change plans of members assigned to them", async () => {
    const { gym } = await makeGym();
    const { staff: trainer } = await staff(gym.id, "TRAINER");
    const mine = await makeMember(gym.id);
    const notMine = await makeMember(gym.id);
    await prisma.member.update({ where: { id: mine.id }, data: { trainerId: trainer.id } });
    const plan = { title: "Cut", goal: "LOSE_FAT", meals: [{ time: "8:00", name: "Breakfast", items: "Eggs" }] };
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: mine.id, plan }))).status).toBe(200);
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: notMine.id, plan }))).status).toBe(403);
    const otherPlan = await prisma.dietPlan.create({ data: { gymId: gym.id, memberId: notMine.id, title: "Someone else's" } });
    expect((await patchDiet(req(`/api/gym/diet-plans/${otherPlan.id}`, { title: "Hijacked" }, "PATCH"), params({ id: otherPlan.id }))).status).toBe(403);
    const listed = await json<{ assigned: { memberId: string }[] }>(await listDiet(req("/api/gym/diet-plans", undefined, "GET")));
    expect(listed.assigned.map((p) => p.memberId)).toEqual([mine.id]);
  });

  it("trainers can't change gym templates written by someone else", async () => {
    const { gym } = await makeGym();
    const shared = await prisma.dietPlan.create({ data: { gymId: gym.id, isTemplate: true, title: "Owner's template" } });
    await staff(gym.id, "TRAINER");
    expect((await patchDiet(req(`/api/gym/diet-plans/${shared.id}`, { title: "Trainer edit" }, "PATCH"), params({ id: shared.id }))).status).toBe(403);
    const own = await json<{ id: string }>(await diet(req("/api/gym/diet-plans", { kind: "template", plan: { title: "Mine", meals: [] } })));
    expect((await patchDiet(req(`/api/gym/diet-plans/${own.id}`, { title: "Mine v2" }, "PATCH"), params({ id: own.id }))).status).toBe(200);
  });

  it("can't reach another gym's template or member", async () => {
    const a = await makeGym();
    const b = await makeGym();
    const foreignTemplate = await prisma.dietPlan.create({ data: { gymId: b.gym.id, isTemplate: true, title: "Theirs" } });
    const foreignMember = await makeMember(b.gym.id);
    const m = await makeMember(a.gym.id);
    await staff(a.gym.id, "OWNER");
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: m.id, templateId: foreignTemplate.id }))).status).toBe(404);
    expect((await diet(req("/api/gym/diet-plans", { kind: "assign", memberId: foreignMember.id, plan: { title: "x1", meals: [] } }))).status).toBe(404);
    expect((await patchDiet(req(`/api/gym/diet-plans/${foreignTemplate.id}`, { title: "Mine now" }, "PATCH"), params({ id: foreignTemplate.id }))).status).toBe(404);
  });

  it("an edit only changes the fields it sends", async () => {
    const { gym } = await makeGym();
    await staff(gym.id, "OWNER");
    const t = await prisma.dietPlan.create({ data: { gymId: gym.id, isTemplate: true, title: "Bulk", goal: "BUILD_MUSCLE", dailyCalories: 2800, meals: [{ time: "", name: "Lunch", items: "Rice" }] } });
    await patchDiet(req(`/api/gym/diet-plans/${t.id}`, { title: "Bulk v2" }, "PATCH"), params({ id: t.id }));
    const after = await prisma.dietPlan.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ title: "Bulk v2", goal: "BUILD_MUSCLE", dailyCalories: 2800 });
    expect(after.meals).toEqual([{ time: "", name: "Lunch", items: "Rice" }]);
  });
});

