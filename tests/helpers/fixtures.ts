import { prisma } from "@/db/client";
import type { AuditActor } from "@/lib/audit";

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const deskActor: AuditActor = { type: "USER", id: null, name: "Test desk", role: "OWNER", ip: null, userAgent: null };

/** The platform-level sandbox gateway row (gymId null) that online checkouts use in tests. */
export async function ensureSandboxProvider() {
  const existing = await prisma.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: "sandbox" } });
  if (existing) return existing;
  return prisma.paymentProviderConfig.create({ data: { providerKey: "sandbox", displayName: "Test gateway", enabled: true, methods: ["test"] } });
}

export async function makeGym() {
  const id = uid();
  const gym = await prisma.gym.create({ data: { name: `Test Gym ${id}`, slug: `test-gym-${id}`, status: "ACTIVE" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, pricePaisa: 150_000, active: true } });
  return { gym, plan };
}

export async function makeMember(gymId: string) {
  const id = uid();
  return prisma.member.create({ data: { gymId, memberCode: `T-${id}`, fullName: `Test Member ${id}`, joinedOn: new Date() } });
}

export async function makeCoupon(gymId: string, over: { perMemberLimit?: number; maxRedemptions?: number | null } = {}) {
  return prisma.coupon.create({
    data: { gymId, code: `T${uid().toUpperCase()}`.slice(0, 20), kind: "PERCENT", value: 5000, appliesTo: "ALL", perMemberLimit: over.perMemberLimit ?? 1, maxRedemptions: over.maxRedemptions === undefined ? null : over.maxRedemptions },
  });
}

export async function makeProduct(gymId: string, inventory: number | null = 10) {
  const id = uid();
  const category = await prisma.marketplaceCategory.create({ data: { name: `Cat ${id}`, slug: `cat-${id}`, kind: "PRODUCT" } });
  return prisma.marketplaceProduct.create({ data: { gymId, categoryId: category.id, kind: "PRODUCT", name: `Shaker ${id}`, pricePaisa: 50_000, inventory, status: "ACTIVE" } });
}
