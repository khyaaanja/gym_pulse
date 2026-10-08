import { prisma } from "@/db/client";
import { limitReached } from "./errors";
import { startOfMonth, today, toDbDate } from "./time";

export type LimitKind = "members" | "staff" | "importsPerMonth" | "predictionsPerMonth" | "notificationsPerMonth";

const LABEL: Record<LimitKind, string> = {
  members: "members",
  staff: "staff accounts",
  importsPerMonth: "record imports this month",
  predictionsPerMonth: "estimates this month",
  notificationsPerMonth: "messages this month",
};

export async function usage(gymId: string, kind: LimitKind, tz: string): Promise<number> {
  const monthStart = toDbDate(startOfMonth(today(tz)));
  switch (kind) {
    case "members":
      // Online sign-ups that haven't bought a plan yet don't count, so fake sign-ups can't use up a gym's quota.
      return prisma.member.count({ where: { gymId, archivedAt: null, NOT: { source: "SELF_SIGNUP", memberships: { none: {} } } } });
    case "staff":
      return prisma.staffMember.count({ where: { gymId, active: true } });
    case "importsPerMonth":
      return prisma.importJob.count({ where: { gymId, startedAt: { gte: monthStart } } });
    case "predictionsPerMonth":
      return prisma.predictionReport.count({ where: { gymId, generatedAt: { gte: monthStart }, source: { not: "SCHEDULED" } } });
    case "notificationsPerMonth":
      return prisma.notification.count({ where: { gymId, createdAt: { gte: monthStart }, channel: { notIn: ["IN_APP", "PUSH"] } } });
  }
}

export async function planLimit(gymId: string, kind: LimitKind): Promise<number | null> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, include: { plan: true } });
  if (!gym?.plan) return null;
  const p = gym.plan;
  const map: Record<LimitKind, number | null> = {
    members: p.memberLimit,
    staff: p.staffLimit,
    importsPerMonth: p.importsPerMonth,
    predictionsPerMonth: p.predictionsPerMonth,
    notificationsPerMonth: p.notificationsPerMonth,
  };
  return map[kind];
}

/** Throws a user-facing 402 when adding `adding` more units would exceed the gym's plan limit. null = unlimited. */
export async function assertWithinLimit(gymId: string, kind: LimitKind, tz: string, adding = 1) {
  const limit = await planLimit(gymId, kind);
  if (limit === null || limit === undefined) return;
  const used = await usage(gymId, kind, tz);
  if (used + adding > limit) {
    throw limitReached(`Your plan allows ${limit} ${LABEL[kind]}. You've used ${used}. Upgrade your plan to add more.`);
  }
}

export async function withinLimit(gymId: string, kind: LimitKind, tz: string, adding = 1): Promise<boolean> {
  try {
    await assertWithinLimit(gymId, kind, tz, adding);
    return true;
  } catch {
    return false;
  }
}

/**
 * An online sign-up starts counting toward the member limit when they get their first membership (see usage), so
 * that is where the limit is checked: before an online checkout starts and before staff record a desk payment.
 */
export async function assertCanActivateMember(gym: { id: string; timezone: string }, member: { id: string; source: string }) {
  if (member.source !== "SELF_SIGNUP") return;
  if (await prisma.membership.count({ where: { gymId: gym.id, memberId: member.id } })) return;
  await assertWithinLimit(gym.id, "members", gym.timezone);
}
