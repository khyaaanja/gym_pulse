import { prisma } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import { addDays, localInstant, toDbDate, type DateOnly } from "@/lib/time";
import { makeGym, makeMember } from "./fixtures";

/** A gym + member with one membership covering 2020..2040 (so back-dated check-ins are "active"). */
export async function gymWithMember(settings: Record<string, unknown> = {}) {
  const { gym, plan } = await makeGym();
  const g = await prisma.gym.update({ where: { id: gym.id }, data: { settings: settings as object } });
  const member = await makeMember(gym.id);
  await giveMembership(gym.id, member.id, plan.id, "2020-01-01", "2040-01-01");
  return { gym: g, plan, member };
}

export async function giveMembership(gymId: string, memberId: string, planId: string, start: DateOnly, end: DateOnly) {
  return prisma.membership.create({ data: { gymId, memberId, planId, startDate: toDbDate(start), endDate: toDbDate(end), pricePaisa: 150_000, status: "ACTIVE" } });
}

/** Noon (or `time`) on a local day in the gym's timezone. */
export const at = (day: DateOnly, tz = "Asia/Kathmandu", time = "12:00:00") => localInstant(day, time, tz);
export const dayRange = (start: DateOnly, n: number, step = 1) => Array.from({ length: n }, (_, i) => addDays(start, i * step));

/** The six default milestones (Bronze 5, Silver 10, Gold 14, Platinum 30 streak; Club 50 / 100 total visits). */
export async function seedMilestones(gymId: string) {
  const badge = await prisma.reward.create({ data: { gymId, name: "Badge", kind: "BADGE" } });
  await prisma.milestone.createMany({
    data: [
      { gymId, name: "Bronze", tier: "Bronze", kind: "STREAK", threshold: 5, rewardId: badge.id },
      { gymId, name: "Silver", tier: "Silver", kind: "STREAK", threshold: 10, rewardId: badge.id },
      { gymId, name: "Gold", tier: "Gold", kind: "STREAK", threshold: 14, rewardId: badge.id },
      { gymId, name: "Platinum", tier: "Platinum", kind: "STREAK", threshold: 30, rewardId: badge.id },
      { gymId, name: "50 visits", tier: "Club 50", kind: "TOTAL_VISITS", threshold: 50, rewardId: badge.id },
      { gymId, name: "100 visits", tier: "Club 100", kind: "TOTAL_VISITS", threshold: 100, rewardId: badge.id },
    ],
  });
  return badge;
}

/** Insert attendance rows directly (no service side effects) for the given local days. */
export async function seedAttendance(gymId: string, memberId: string, days: DateOnly[], tz = "Asia/Kathmandu") {
  await prisma.attendance.createMany({ data: days.map((d) => ({ gymId, memberId, localDate: toDbDate(d), checkedInAt: at(d, tz), method: "STAFF" as const })) });
}

export async function makeDevice(gymId: string, over: { kind?: "NFC_READER" | "KIOSK"; active?: boolean; locationId?: string } = {}) {
  const key = randomToken(24);
  const device = await prisma.checkInDevice.create({ data: { gymId, name: "Door reader", kind: over.kind ?? "NFC_READER", keyHash: sha256(key), keyPrefix: key.slice(0, 6), active: over.active ?? true, locationId: over.locationId } });
  return { device, key };
}

export const rewardKeys = async (memberId: string) => (await prisma.memberReward.findMany({ where: { memberId }, select: { sourceKey: true } })).map((r) => r.sourceKey).sort();
