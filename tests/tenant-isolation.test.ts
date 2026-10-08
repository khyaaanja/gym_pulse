import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import { makeCoupon, makeGym, makeMember, makeProduct } from "./helpers/fixtures";
import { jar, makeUser, params, req, signInMember, signInStaff, signOut } from "./helpers/route";

vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);

/**
 * Cross-tenant attacks: the owner of gym A (who holds every permission there) aims each id-taking route at a row
 * that belongs to gym B. Every attempt must be refused AND leave gym B's row exactly as it was. A status check
 * alone isn't enough: a handler could answer 404 after writing.
 */
type R = (req: Request, rc?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const route = async (path: string) => (await import(/* @vite-ignore */ `@/app/api/${path}/route`)) as Record<string, R>;

let victim: Awaited<ReturnType<typeof makeVictim>>;
let attackerGymId: string;
let ownerToken: string;
let attackerMemberId: string;

async function makeVictim() {
  const { gym, plan } = await makeGym();
  const member = await makeMember(gym.id);
  await prisma.membership.create({ data: { gymId: gym.id, memberId: member.id, planId: plan.id, startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 20 * 86_400_000), pricePaisa: plan.pricePaisa, status: "ACTIVE" } });
  const trainerUser = await makeUser("Victim trainer");
  const trainer = await prisma.staffMember.create({ data: { gymId: gym.id, userId: trainerUser.id, role: "TRAINER" } });
  const staffUser = await makeUser("Victim staff");
  const staff = await prisma.staffMember.create({ data: { gymId: gym.id, userId: staffUser.id, role: "STAFF" } });
  const product = await makeProduct(gym.id, 10);
  const product2 = await makeProduct(gym.id, 10);
  const coupon = await makeCoupon(gym.id);
  const announcement = await prisma.announcement.create({ data: { gymId: gym.id, target: "GYM", title: "Victim news", body: "Only for gym B", status: "PUBLISHED" } });
  const booking = await prisma.booking.create({ data: { gymId: gym.id, memberId: member.id, title: "PT pack", sessionsTotal: 10 } });
  const device = await prisma.checkInDevice.create({ data: { gymId: gym.id, name: "Front reader", kind: "NFC_READER", keyHash: sha256(randomToken()), keyPrefix: "abcd1234" } });
  const diet = await prisma.dietPlan.create({ data: { gymId: gym.id, title: "Victim diet", memberId: member.id } });
  const template = await prisma.dietPlan.create({ data: { gymId: gym.id, title: "Victim template", isTemplate: true } });
  const file = await prisma.importedFile.create({ data: { gymId: gym.id, originalName: "r.csv", mimeType: "text/csv", kind: "CSV", sizeBytes: 10, sha256: "x", uploadedById: staffUser.id, rawExpiresAt: new Date(Date.now() + 86_400_000) } });
  const importJob = await prisma.importJob.create({ data: { gymId: gym.id, fileId: file.id, createdById: staffUser.id } });
  const importRow = await prisma.importRow.create({ data: { gymId: gym.id, importJobId: importJob.id, rowIndex: 0, raw: ["A"], normalized: { fullName: "Row Person" }, status: "NEEDS_REVIEW" } });
  const lead = await prisma.lead.create({ data: { gymId: gym.id, name: "Victim lead" } });
  const location = await prisma.location.create({ data: { gymId: gym.id, name: "Victim branch" } });
  const order = await prisma.marketplaceOrder.create({ data: { gymId: gym.id, memberId: member.id, number: `V-${randomToken(4)}`, subtotalPaisa: 50_000, totalPaisa: 50_000, status: "PAID" } });
  const report = await prisma.predictionReport.create({ data: { gymId: gym.id, source: "MANUAL", modelVersion: "t", horizonDays: 30, membersAnalyzed: 1, attendanceRecords: 1, confidence: "LOW", configSnapshot: {} } });
  const promo = await prisma.gymPromotion.create({ data: { gymId: gym.id, title: "Victim offer" } });
  const task = await prisma.recoveryTask.create({ data: { gymId: gym.id, memberId: member.id, reason: "Inactive" } });
  const reward = await prisma.reward.create({ data: { gymId: gym.id, name: "Victim reward", kind: "BADGE" } });
  const image = await prisma.storedFile.create({ data: { gymId: gym.id, kind: "PRODUCT_IMAGE", mimeType: "image/webp", sizeBytes: 1, storageKey: `public/${gym.id}/x.bin`, uploadedBy: staffUser.id } });
  return { gym, plan, member, trainer, staff, product, product2, coupon, announcement, booking, device, diet, template, importJob, importRow, lead, location, order, report, promo, task, reward, image };
}

/** Everything gym B owns, serialised, so a test can prove nothing changed. */
async function victimState() {
  const g = victim.gym.id;
  const where = { gymId: g };
  const [rows, counts] = await Promise.all([
    Promise.all([
      prisma.member.findMany({ where, orderBy: { id: "asc" } }),
      prisma.membership.findMany({ where, orderBy: { id: "asc" } }),
      prisma.membershipPlan.findMany({ where, orderBy: { id: "asc" } }),
      prisma.staffMember.findMany({ where, orderBy: { id: "asc" } }),
      prisma.marketplaceProduct.findMany({ where, orderBy: { id: "asc" } }),
      prisma.coupon.findMany({ where, orderBy: { id: "asc" } }),
      prisma.announcement.findMany({ where, orderBy: { id: "asc" } }),
      prisma.booking.findMany({ where, orderBy: { id: "asc" } }),
      prisma.checkInDevice.findMany({ where, orderBy: { id: "asc" } }),
      prisma.dietPlan.findMany({ where, orderBy: { id: "asc" } }),
      prisma.importJob.findMany({ where, orderBy: { id: "asc" } }),
      prisma.importRow.findMany({ where, orderBy: { id: "asc" } }),
      prisma.lead.findMany({ where, orderBy: { id: "asc" } }),
      prisma.location.findMany({ where, orderBy: { id: "asc" } }),
      prisma.marketplaceOrder.findMany({ where, orderBy: { id: "asc" } }),
      prisma.predictionReport.findMany({ where, orderBy: { id: "asc" } }),
      prisma.gymPromotion.findMany({ where, orderBy: { id: "asc" } }),
      prisma.recoveryTask.findMany({ where, orderBy: { id: "asc" } }),
      prisma.reward.findMany({ where, orderBy: { id: "asc" } }),
    ]),
    Promise.all([
      prisma.attendance.count({ where }),
      prisma.payment.count({ where }),
      prisma.recoveryEvent.count({ where }),
      prisma.invite.count({ where }),
      prisma.notification.count({ where }),
    ]),
  ]);
  return JSON.stringify({ rows, counts });
}

beforeAll(async () => {
  victim = await makeVictim();
  const attacker = await makeGym();
  attackerGymId = attacker.gym.id;
  attackerMemberId = (await makeMember(attackerGymId)).id;
  await prisma.membership.create({ data: { gymId: attackerGymId, memberId: attackerMemberId, planId: attacker.plan.id, startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 20 * 86_400_000), pricePaisa: attacker.plan.pricePaisa, status: "ACTIVE" } });
  await signInStaff(attackerGymId, "OWNER");
  ownerToken = jar.user;
}, 120_000);
beforeEach(() => {
  signOut();
  jar.user = ownerToken;
});

type Attack = { name: string; path: string; method: string; params?: () => Record<string, string>; body?: () => unknown; query?: string };
const ATTACKS: Attack[] = [
  // ── id in the URL ──
  { name: "edit announcement", path: "gym/announcements/[id]", method: "PATCH", params: () => ({ id: victim.announcement.id }), body: () => ({ title: "Hijacked title" }) },
  { name: "delete announcement", path: "gym/announcements/[id]", method: "DELETE", params: () => ({ id: victim.announcement.id }) },
  { name: "edit booking", path: "gym/bookings/[id]", method: "PATCH", params: () => ({ id: victim.booking.id }), body: () => ({ sessionsUsed: 3, status: "CONFIRMED" }) },
  { name: "toggle coupon", path: "gym/coupons/[id]", method: "PATCH", params: () => ({ id: victim.coupon.id }), body: () => ({ active: false }) },
  { name: "revoke device", path: "gym/devices/[id]", method: "DELETE", params: () => ({ id: victim.device.id }) },
  { name: "edit diet plan", path: "gym/diet-plans/[id]", method: "PATCH", params: () => ({ id: victim.diet.id }), body: () => ({ title: "Hijacked diet" }) },
  { name: "end diet plan", path: "gym/diet-plans/[id]", method: "DELETE", params: () => ({ id: victim.diet.id }) },
  { name: "read import", path: "gym/imports/[id]", method: "GET", params: () => ({ id: victim.importJob.id }) },
  { name: "purge import", path: "gym/imports/[id]", method: "DELETE", params: () => ({ id: victim.importJob.id }), query: "?purge=true" },
  { name: "read import rows", path: "gym/imports/[id]/rows", method: "GET", params: () => ({ id: victim.importJob.id }) },
  { name: "edit import row", path: "gym/imports/[id]/rows/[rowId]", method: "PATCH", params: () => ({ id: victim.importJob.id, rowId: victim.importRow.id }), body: () => ({ values: { fullName: "Hijacked" } }) },
  { name: "row actions", path: "gym/imports/[id]/actions", method: "POST", params: () => ({ id: victim.importJob.id }), body: () => ({ rowIds: [victim.importRow.id], action: "EXCLUDE" }) },
  { name: "change mappings", path: "gym/imports/[id]/mappings", method: "PATCH", params: () => ({ id: victim.importJob.id }), body: () => ({ changes: [{ sourceIndex: 0, targetField: "phone" }] }) },
  { name: "commit import", path: "gym/imports/[id]/commit", method: "POST", params: () => ({ id: victim.importJob.id }) },
  { name: "reprocess import", path: "gym/imports/[id]/reprocess", method: "POST", params: () => ({ id: victim.importJob.id }) },
  { name: "edit lead", path: "gym/leads/[id]", method: "PATCH", params: () => ({ id: victim.lead.id }), body: () => ({ status: "LOST" }) },
  { name: "convert lead", path: "gym/leads/[id]/convert", method: "POST", params: () => ({ id: victim.lead.id }) },
  { name: "edit branch", path: "gym/locations/[id]", method: "PATCH", params: () => ({ id: victim.location.id }), body: () => ({ name: "Hijacked branch" }) },
  { name: "read member", path: "gym/members/[id]", method: "GET", params: () => ({ id: victim.member.id }) },
  { name: "edit member", path: "gym/members/[id]", method: "PATCH", params: () => ({ id: victim.member.id }), body: () => ({ fullName: "Hijacked Name", status: "SUSPENDED" }) },
  { name: "archive member", path: "gym/members/[id]", method: "DELETE", params: () => ({ id: victim.member.id }) },
  { name: "invite member", path: "gym/members/[id]/invite", method: "POST", params: () => ({ id: victim.member.id }) },
  { name: "fulfil order", path: "gym/orders/[id]", method: "POST", params: () => ({ id: victim.order.id }) },
  { name: "edit plan price", path: "gym/plans/[id]", method: "PATCH", params: () => ({ id: victim.plan.id }), body: () => ({ priceRupees: 1 }) },
  { name: "read prediction", path: "gym/predictions/[id]", method: "GET", params: () => ({ id: victim.report.id }) },
  { name: "edit product", path: "gym/products/[id]", method: "PATCH", params: () => ({ id: victim.product.id }), body: () => ({ priceRupees: 1, inventory: 0 }) },
  { name: "edit promotion", path: "gym/promotions/[id]", method: "PATCH", params: () => ({ id: victim.promo.id }), body: () => ({ title: "Hijacked offer" }) },
  { name: "delete promotion", path: "gym/promotions/[id]", method: "DELETE", params: () => ({ id: victim.promo.id }) },
  { name: "read recovery task", path: "gym/recovery/[id]", method: "GET", params: () => ({ id: victim.task.id }) },
  { name: "log recovery contact", path: "gym/recovery/[id]", method: "POST", params: () => ({ id: victim.task.id }), body: () => ({ action: "contact", method: "CALL", note: "x" }) },
  { name: "mark recovery lost", path: "gym/recovery/[id]", method: "POST", params: () => ({ id: victim.task.id }), body: () => ({ action: "lost" }) },
  { name: "add recovery note", path: "gym/recovery/[id]", method: "POST", params: () => ({ id: victim.task.id }), body: () => ({ action: "note", note: "x" }) },
  { name: "change staff access", path: "gym/staff/[id]", method: "PATCH", params: () => ({ id: victim.staff.id }), body: () => ({ active: false }) },
  // ── id in the body ──
  { name: "desk check-in", path: "gym/checkin", method: "POST", body: () => ({ memberId: victim.member.id }) },
  { name: "check-in at another gym's branch", path: "gym/checkin", method: "POST", body: () => ({ memberId: attackerMemberId, locationId: victim.location.id }) },
  { name: "desk payment", path: "gym/payments/manual", method: "POST", body: () => ({ memberId: victim.member.id, planId: victim.plan.id, method: "CASH" }) },
  { name: "start recovery", path: "gym/recovery", method: "POST", body: () => ({ memberId: victim.member.id }) },
  { name: "assign diet plan", path: "gym/diet-plans", method: "POST", body: () => ({ kind: "assign", memberId: victim.member.id, templateId: victim.template.id }) },
  { name: "device at another gym's branch", path: "gym/devices", method: "POST", body: () => ({ name: "Sneaky", kind: "KIOSK", locationId: victim.location.id }) },
  { name: "challenge with another gym's reward", path: "gym/engagement", method: "POST", body: () => ({ type: "milestone", name: "Sneaky", tier: "X", kind: "STREAK", threshold: 3, rewardId: victim.reward.id, active: true }) },
  { name: "update another gym's reward by id", path: "gym/engagement", method: "POST", body: () => ({ type: "reward", id: victim.reward.id, name: "Hijacked reward", kind: "BADGE", active: true }) },
  { name: "promotion with another gym's coupon", path: "gym/promotions", method: "POST", body: () => ({ title: "Sneaky offer", couponId: victim.coupon.id }) },
  { name: "promotion with another gym's plan", path: "gym/promotions", method: "POST", body: () => ({ title: "Sneaky offer", planId: victim.plan.id }) },
  { name: "bundle of another gym's products", path: "gym/products/bundles", method: "POST", body: () => ({ name: "Sneaky bundle", categoryId: victim.product.categoryId, priceRupees: 100, items: [{ productId: victim.product.id, quantity: 1 }, { productId: victim.product2.id, quantity: 1 }] }) },
  { name: "member with another gym's plan", path: "gym/members", method: "POST", body: () => ({ fullName: "Sneaky Member", planId: victim.plan.id }) },
  { name: "member with another gym's trainer", path: "gym/members", method: "POST", body: () => ({ fullName: "Sneaky Member", trainerId: victim.trainer.id }) },
  { name: "product with another gym's trainer", path: "gym/products", method: "POST", body: () => ({ name: "Sneaky PT", categoryId: victim.product.categoryId, priceRupees: 100, trainerId: victim.trainer.id }) },
];

describe("gym owner A against gym B's rows", () => {
  for (const a of ATTACKS) {
    it(`${a.name} (${a.method} /api/${a.path})`, async () => {
      const before = await victimState();
      const handler = (await route(a.path))[a.method]!;
      const res = await handler(req(`/api/${a.path}${a.query ?? ""}`, { method: a.method, body: a.body?.() }), params(a.params?.() ?? {}));
      expect(res.status, await res.clone().text()).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await victimState()).toBe(before);
    });
  }

  it("nothing gym A created points at gym B", async () => {
    const a = attackerGymId;
    expect(await prisma.member.count({ where: { gymId: a, trainerId: { in: [victim.trainer.id] } } })).toBe(0);
    expect(await prisma.membership.count({ where: { gymId: a, plan: { gymId: victim.gym.id } } })).toBe(0);
    expect(await prisma.gymPromotion.count({ where: { gymId: a, OR: [{ couponId: victim.coupon.id }, { planId: victim.plan.id }] } })).toBe(0);
    expect(await prisma.milestone.count({ where: { gymId: a, rewardId: victim.reward.id } })).toBe(0);
    expect(await prisma.checkInDevice.count({ where: { gymId: a, locationId: victim.location.id } })).toBe(0);
    expect(await prisma.marketplaceProduct.count({ where: { gymId: a, trainerId: victim.trainer.id } })).toBe(0);
    // A refused create must not leave half a record behind either.
    expect(await prisma.member.count({ where: { gymId: a, fullName: "Sneaky Member" } })).toBe(0);
    expect(await prisma.marketplaceProduct.count({ where: { gymId: a, name: { in: ["Sneaky PT", "Sneaky bundle"] } } })).toBe(0);
    expect(await prisma.attendance.count({ where: { gymId: a, memberId: attackerMemberId } })).toBe(0);
  });
});

describe("uploaded images belong to the gym that uploaded them", () => {
  it("a product can't use another gym's image", async () => {
    const product = await makeProduct(attackerGymId);
    const { PATCH } = await route("gym/products/[id]");
    const res = await PATCH!(req(`/api/gym/products/${product.id}`, { method: "PATCH", body: { imageFileId: victim.image.id } }), params({ id: product.id }));
    expect(res.status).toBe(400);
    expect((await prisma.marketplaceProduct.findUniqueOrThrow({ where: { id: product.id } })).imageFileId).toBeNull();
  });

  it("a gym can't use another gym's file as its logo", async () => {
    const { PATCH } = await route("gym/settings");
    const res = await PATCH!(req("/api/gym/settings", { method: "PATCH", body: { profile: { logoFileId: victim.image.id } } }), params());
    expect(res.status).toBe(400);
    expect((await prisma.gym.findUniqueOrThrow({ where: { id: attackerGymId } })).logoFileId).toBeNull();
  });
});

describe("members of gym A against gym B", () => {
  it("can't renew onto gym B's plan, order gym B's products, or pay gym B's order", async () => {
    const m = await makeMember(attackerGymId);
    await signInMember(attackerGymId, m.id);
    const before = await victimState();
    const renew = (await route("me/renew")).POST!;
    const order = (await route("me/orders")).POST!;
    const pay = (await route("me/orders/[id]/pay")).POST!;
    const r1 = await renew(req("/api/me/renew", { body: { planId: victim.plan.id, provider: "sandbox" } }), params());
    const r2 = await order(req("/api/me/orders", { body: { items: [{ productId: victim.product.id, quantity: 1 }] } }), params());
    const r3 = await pay(req(`/api/me/orders/${victim.order.id}/pay`, { body: { provider: "sandbox" } }), params({ id: victim.order.id }));
    for (const r of [r1, r2, r3]) expect([400, 403, 404]).toContain(r.status);
    expect(await victimState()).toBe(before);
    expect(await prisma.payment.count({ where: { memberId: m.id } })).toBe(0);
    expect(await prisma.marketplaceOrder.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("can't switch their session into a gym they don't belong to", async () => {
    const m = await makeMember(attackerGymId);
    const { user } = await signInMember(attackerGymId, m.id);
    const { POST } = await route("auth/switch-gym");
    const res = await POST!(req("/api/auth/switch-gym", { body: { gymId: victim.gym.id } }), params());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.session.findFirstOrThrow({ where: { userId: user.id } })).activeGymId).toBe(attackerGymId);
  });
});
