import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { hashPassword } from "@/lib/auth/password";
import { today } from "@/lib/time";
import { checkIn, checkInsOn } from "@/services/attendance";
import { makeGym, makeMember } from "./helpers/fixtures";

describe("trainers see only their assigned members", () => {
  it("today's check-in list", async () => {
    const { gym } = await makeGym();
    const user = await prisma.user.create({ data: { name: "Trainer", email: `trainer-${Date.now()}@example.test`, passwordHash: await hashPassword("Trainer-Pass-1") } });
    const trainer = await prisma.staffMember.create({ data: { gymId: gym.id, userId: user.id, role: "TRAINER" } });
    const mine = await makeMember(gym.id);
    const other = await makeMember(gym.id);
    await prisma.member.update({ where: { id: mine.id }, data: { trainerId: trainer.id } });
    const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } });
    for (const m of [mine, other]) await prisma.membership.create({ data: { gymId: gym.id, memberId: m.id, planId: plan.id, startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 20 * 86_400_000), pricePaisa: plan.pricePaisa, status: "ACTIVE" } });
    await checkIn(gym, mine.id, "STAFF");
    await checkIn(gym, other.id, "STAFF");
    const db = tenantDb(gym.id);
    const day = today(gym.timezone);

    const trainerView = await checkInsOn({ staff: trainer, db }, day);
    expect(trainerView.map((a) => a.member.id)).toEqual([mine.id]);
    const ownerView = await checkInsOn({ staff: { id: "owner", role: "OWNER" }, db }, day);
    expect(ownerView.map((a) => a.member.id).sort()).toEqual([mine.id, other.id].sort());
  });
});

/**
 * Property sweep: every page or route a trainer can reach that reads member-level data must go through the scope
 * helpers in src/lib/scope.ts. A new surface that doesn't fails here until it either uses them or is added to the
 * allowlist below with the reason it's safe.
 */
const TRAINER_PERMISSIONS = ["members.view", "attendance.view", "attendance.create", "bookings.manage", "diet.manage"];
const SCOPED = /\b(memberScope|bookingScope|canSeeMember|canSeeBooking|checkInsOn)\(/;
// Every model whose rows name or describe a member. Missing one here is how the marketplace-orders leak got past
// the first version of this sweep.
const READS_MEMBER_DATA = /\.(member|attendance|booking|checkIn|recoveryTask|recoveryEvent|riskAssessment|riskHistory|membership|payment|invoice|marketplaceOrder|couponRedemption|memberReward|challengeProgress|notification|dietPlan)\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|groupBy)\(/;

const ALLOWLIST: Record<string, string> = {
  "src/app/app/pulse/page.tsx": "passes trainerId to the pulse queries for trainers (see src/services/pulse.ts)",
  "src/app/app/receipts/[id]/page.tsx": "staff need payments.view, which trainers don't have",
  "src/components/app/staff-market.tsx": "member data (orders) loads only with marketplace.manage; coupons only with payments.manage",
  "src/app/api/gym/diet-plans/starter/route.ts": "reads only template titles (isTemplate: true), which belong to no member",
};

function trainerReachable(src: string) {
  if (/\bappMode\(/.test(src)) return true;
  // Server components rendered with the staff context (e.g. StaffRenew) are reachable by whoever reaches their page.
  if (/ctx: GymContext\b/.test(src)) return true;
  return TRAINER_PERMISSIONS.some((p) => src.includes(`permission: "${p}"`) || src.includes(`requireStaff("${p}")`) || src.includes(`can("${p}")`));
}

describe("trainer scoping sweep", () => {
  const files = [...globSync("src/app/**/page.tsx"), ...globSync("src/app/api/gym/**/route.ts"), ...globSync("src/components/app/*.tsx")].sort();

  it("finds the surfaces it is meant to check", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => trainerReachable(readFileSync(f, "utf8"))).length).toBeGreaterThan(10);
  });

  it("every trainer-reachable surface that reads member data is scoped or explicitly allowed", () => {
    const unscoped = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return trainerReachable(src) && READS_MEMBER_DATA.test(src) && !SCOPED.test(src) && !(f in ALLOWLIST);
    });
    expect(unscoped).toEqual([]);
  });

  it("allowlisted files still exist (stale entries hide nothing)", () => {
    for (const f of Object.keys(ALLOWLIST)) expect(files).toContain(f);
  });
});
