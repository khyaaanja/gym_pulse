import { tenantDb } from "@/db/tenant";
import { addDays, diffDays, fromDbDate, localDate, today as todayIn, toDbDate, type DateOnly } from "@/lib/time";
import { riskAsOf } from "./risk/run";
import { monthlyEquivalent } from "@/lib/money";
import type { Gym, Prisma, RiskStatus } from "@/generated/prisma/client";

export type PulseCard = {
  id: string;
  fullName: string;
  memberCode: string;
  phone: string | null;
  plan: string | null;
  expiry: string | null;
  daysToExpiry: number | null;
  lastVisit: string | null;
  daysInactive: number | null;
  visitsLast30: number;
  visitsPrev30: number;
  trend: "up" | "flat" | "down" | "unknown";
  monthlyFeePaisa: number;
  riskStatus: RiskStatus;
  riskCategory: string | null;
  riskScore: number | null;
  topReason: string | null;
  task: { id: string; status: string; lastContactAt: Date | null; followUpAt: Date | null } | null;
};

/**
 * Members-at-risk list for the Pulse screen, ordered by revenue at stake then days inactive.
 * One page at a time — never the whole gym.
 */
export async function pulseList(gym: Gym, opts: { filter: "AT_RISK" | "ATTENTION" | "LOST" | "ALL"; page: number; pageSize: number; trainerId?: string; asOf?: DateOnly }) {
  const db = tenantDb(gym.id);
  // Same "as of" day the risk statuses were computed for, so the cards agree with them.
  const today = opts.asOf ?? (await riskAsOf(gym.id, todayIn(gym.timezone))).asOf;
  const where: Prisma.MemberWhereInput = {
    archivedAt: null,
    ...(opts.filter === "ALL" ? { riskStatus: { in: ["AT_RISK", "ATTENTION"] } } : { riskStatus: opts.filter }),
    ...(opts.trainerId ? { trainerId: opts.trainerId } : {}),
  };
  const [members, total] = await Promise.all([
    db.member.findMany({
      where,
      orderBy: [{ riskScore: { sort: "desc", nulls: "last" } }, { lastAttendanceAt: { sort: "asc", nulls: "first" } }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        memberships: { where: { status: { in: ["ACTIVE", "EXPIRED"] } }, orderBy: { endDate: "desc" }, take: 1, include: { plan: true } },
        recoveryTasks: { where: { closedAt: null }, take: 1 },
        riskAssessments: { orderBy: { assessedAt: "desc" }, take: 1, select: { factors: true } },
      },
    }),
    db.member.count({ where }),
  ]);
  const ids = members.map((m) => m.id);
  const since = toDbDate(addDays(today, -60));
  const mid = addDays(today, -30);
  const visits = ids.length ? await db.attendance.groupBy({ by: ["memberId", "localDate"], where: { memberId: { in: ids }, localDate: { gt: since } } }) : [];

  const items: PulseCard[] = members.map((m) => {
    const ms = m.memberships[0];
    const mine = visits.filter((v) => v.memberId === m.id).map((v) => fromDbDate(v.localDate));
    const last30 = mine.filter((d) => d > mid).length;
    const prev30 = mine.filter((d) => d <= mid).length;
    const lastVisit = m.lastAttendanceAt ? localDate(m.lastAttendanceAt, gym.timezone) : null;
    const active = ms && fromDbDate(ms.endDate) >= today;
    return {
      id: m.id,
      fullName: m.fullName,
      memberCode: m.memberCode,
      phone: m.phone,
      plan: ms?.plan.name ?? null,
      expiry: ms ? fromDbDate(ms.endDate) : null,
      daysToExpiry: ms ? diffDays(today, fromDbDate(ms.endDate)) : null,
      lastVisit,
      daysInactive: lastVisit ? diffDays(lastVisit, today) : null,
      visitsLast30: last30,
      visitsPrev30: prev30,
      trend: prev30 === 0 && last30 === 0 ? "unknown" : last30 > prev30 * 1.15 ? "up" : last30 < prev30 * 0.85 ? "down" : "flat",
      monthlyFeePaisa: active && ms ? monthlyEquivalent(ms.pricePaisa, ms.plan.durationDays) : 0,
      riskStatus: m.riskStatus,
      riskCategory: m.riskCategory,
      riskScore: m.riskScore,
      topReason: ((m.riskAssessments[0]?.factors ?? []) as { detail: string }[])[0]?.detail ?? null,
      task: m.recoveryTasks[0] ? { id: m.recoveryTasks[0].id, status: m.recoveryTasks[0].status, lastContactAt: m.recoveryTasks[0].lastContactAt, followUpAt: m.recoveryTasks[0].followUpAt } : null,
    };
  });
  return { items, total };
}
