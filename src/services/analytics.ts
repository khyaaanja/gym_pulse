import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { gymSettings } from "@/config/gym-settings";
import { addDays, fromDbDate, startOfLocalDay, toDbDate, today as todayIn, type DateOnly } from "@/lib/time";
import type { Gym } from "@/generated/prisma/client";
import { recoveryMetrics } from "./recovery";

export type Range = { from: DateOnly; to: DateOnly; days: number };

export function rangeFor(key: string | null | undefined, tz: string, custom?: { from?: string; to?: string }): Range {
  const to = todayIn(tz);
  if (key === "custom" && custom?.from && custom?.to && custom.from <= custom.to) {
    return { from: custom.from, to: custom.to, days: Math.round((+new Date(custom.to) - +new Date(custom.from)) / 86_400_000) + 1 };
  }
  const days = key === "today" ? 1 : key === "7d" ? 7 : key === "90d" ? 90 : 30;
  return { from: addDays(to, -(days - 1)), to, days };
}

/**
 * Revenue at risk (fact): sum of monthly-equivalent fees of AT_RISK members holding a membership
 * that covers `today`. EXPIRED is included because `today` may be a past "as of" date (see
 * riskAsOf); for the real today the date check alone already excludes ended memberships.
 */
export async function revenueAtRisk(gymId: string, today: DateOnly) {
  const rows = await prisma.$queryRaw<{ members: bigint; paisa: bigint | null }[]>`
    SELECT COUNT(*) AS members, SUM(fee) AS paisa FROM (
      SELECT DISTINCT ON (m."id") m."id", (ms."pricePaisa" * 30 / p."durationDays") AS fee
      FROM "Member" m
      JOIN "Membership" ms ON ms."memberId" = m."id" AND ms."status" IN ('ACTIVE', 'EXPIRED') AND ms."startDate" <= ${toDbDate(today)} AND ms."endDate" >= ${toDbDate(today)}
      JOIN "MembershipPlan" p ON p."id" = ms."planId"
      WHERE m."gymId" = ${gymId} AND m."riskStatus" = 'AT_RISK' AND m."archivedAt" IS NULL
      ORDER BY m."id", ms."endDate" DESC
    ) x`;
  return { members: Number(rows[0]?.members ?? 0), paisa: Number(rows[0]?.paisa ?? 0) };
}

export async function activeMembership(gymId: string, today: DateOnly) {
  const rows = await prisma.$queryRaw<{ members: bigint; mrr: bigint | null }[]>`
    SELECT COUNT(*) AS members, SUM(fee) AS mrr FROM (
      SELECT DISTINCT ON (ms."memberId") ms."memberId", (ms."pricePaisa" * 30 / p."durationDays") AS fee
      FROM "Membership" ms JOIN "MembershipPlan" p ON p."id" = ms."planId"
      JOIN "Member" m ON m."id" = ms."memberId" AND m."archivedAt" IS NULL
      WHERE ms."gymId" = ${gymId} AND ms."status" = 'ACTIVE' AND ms."startDate" <= ${toDbDate(today)} AND ms."endDate" >= ${toDbDate(today)}
      ORDER BY ms."memberId", ms."endDate" DESC
    ) x`;
  return { members: Number(rows[0]?.members ?? 0), mrrPaisa: Number(rows[0]?.mrr ?? 0) };
}

/**
 * Renewal rate = memberships that ended in the period and were renewed ÷ memberships that
 * ended in the period. Memberships still inside their grace period are excluded (undecided).
 */
export async function renewalRate(gymId: string, range: Range, graceDays: number, tz: string) {
  const decidedUntil = [range.to, addDays(todayIn(tz), -graceDays)].sort()[0]!;
  if (decidedUntil < range.from) return { expired: 0, renewed: 0, rate: null as number | null };
  const rows = await prisma.$queryRaw<{ expired: bigint; renewed: bigint }[]>`
    SELECT COUNT(*) AS expired,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "Membership" n WHERE n."memberId" = ms."memberId" AND n."id" <> ms."id"
          AND n."startDate" > ms."startDate" AND n."startDate" <= ms."endDate" + ${graceDays + 1}::int
          AND n."status" IN ('ACTIVE', 'EXPIRED')
      )) AS renewed
    FROM "Membership" ms
    WHERE ms."gymId" = ${gymId} AND ms."endDate" BETWEEN ${toDbDate(range.from)} AND ${toDbDate(decidedUntil)} AND ms."status" IN ('ACTIVE', 'EXPIRED')`;
  const expired = Number(rows[0]?.expired ?? 0);
  const renewed = Number(rows[0]?.renewed ?? 0);
  return { expired, renewed, rate: expired ? renewed / expired : null };
}

export async function attendanceSeries(gymId: string, range: Range) {
  const rows = await prisma.$queryRaw<{ day: Date; visits: bigint }[]>`
    SELECT "localDate" AS day, COUNT(*) AS visits FROM "Attendance"
    WHERE "gymId" = ${gymId} AND "localDate" BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(rows.map((r) => [fromDbDate(r.day), Number(r.visits)]));
  const out: { date: DateOnly; visits: number }[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push({ date: d, visits: byDay.get(d) ?? 0 });
  return out;
}

export async function gymDashboard(gym: Gym, range: Range) {
  const db = tenantDb(gym.id);
  const today = todayIn(gym.timezone);
  const from = startOfLocalDay(range.from, gym.timezone);
  const settings = gymSettings(gym.settings);

  const [risk, active, renewal, recovery, byStatus, latestReport, series, todayCheckins, weekCheckins, monthVisits, payments, orders, ptRevenue, lostInPeriod] = await Promise.all([
    revenueAtRisk(gym.id, today),
    activeMembership(gym.id, today),
    renewalRate(gym.id, range, settings.renewal.gracePeriodDays, gym.timezone),
    recoveryMetrics(gym.id, from),
    db.member.groupBy({ by: ["riskStatus"], where: { archivedAt: null }, _count: true }),
    db.predictionReport.findFirst({ orderBy: { generatedAt: "desc" }, include: { revenueProjection: true, factors: { orderBy: { sortOrder: "asc" } } } }),
    // Today is still in progress, so the chart ends yesterday; today's count is shown separately.
    attendanceSeries(gym.id, { from: addDays(range.to, -Math.max(14, range.days)), to: addDays(range.to, -1), days: Math.max(14, range.days) }),
    db.attendance.count({ where: { localDate: toDbDate(today) } }),
    db.attendance.count({ where: { localDate: { gte: toDbDate(addDays(today, -6)) } } }),
    db.attendance.count({ where: { localDate: { gte: toDbDate(addDays(today, -29)) } } }),
    db.payment.aggregate({ _sum: { amountPaisa: true }, _count: true, where: { status: "SUCCEEDED", purpose: "MEMBERSHIP", method: { not: "IMPORTED" }, paidAt: { gte: from } } }),
    db.marketplaceOrder.aggregate({ _sum: { totalPaisa: true, gymSharePaisa: true }, _count: true, where: { status: { in: ["PAID", "FULFILLED"] }, paidAt: { gte: from } } }),
    db.orderItem.findMany({ where: { kind: "SERVICE", order: { status: { in: ["PAID", "FULFILLED"] }, paidAt: { gte: from } } }, select: { unitPricePaisa: true, quantity: true } }),
    db.riskHistory.count({ where: { toStatus: "LOST", changedAt: { gte: from } } }),
  ]);

  const count = (s: string) => byStatus.find((b) => b.riskStatus === s)?._count ?? 0;
  return {
    range,
    actual: {
      revenueAtRiskPaisa: risk.paisa,
      atRiskMembers: risk.members,
      activeMembers: active.members,
      mrrPaisa: active.mrrPaisa,
      renewal,
      renewalRevenuePaisa: payments._sum.amountPaisa ?? 0,
      renewalPayments: payments._count,
      marketplaceRevenuePaisa: orders._sum.totalPaisa ?? 0,
      marketplaceGymSharePaisa: orders._sum.gymSharePaisa ?? 0,
      marketplaceOrders: orders._count,
      ptRevenuePaisa: ptRevenue.reduce((a, i) => a + i.unitPricePaisa * i.quantity, 0),
      statusCounts: { ACTIVE: count("ACTIVE"), ATTENTION: count("ATTENTION"), AT_RISK: count("AT_RISK"), LOST: count("LOST") },
      churnedInPeriod: lostInPeriod,
      recovery: { contacted: recovery.contacted, recovered: recovery.recovered, rate: recovery.recoveryRate, renewedWithoutContact: recovery.renewedWithoutContact },
      attendance: {
        today: todayCheckins,
        last7Days: weekCheckins,
        last30Days: monthVisits,
        avgVisitsPerMember30d: active.members ? Math.round((monthVisits / active.members) * 10) / 10 : null,
        series,
      },
    },
    estimated: {
      revenueProtectedPaisa: recovery.protectedRevenuePaisa,
      report: latestReport,
    },
  };
}

export async function actionCenter(gym: Gym) {
  const db = tenantDb(gym.id);
  const today = todayIn(gym.timezone);
  const now = new Date();
  const [critical, inactive, expiring, failedPayments, followUps, pendingOrders, pendingBookings, importIssues] = await Promise.all([
    db.member.findMany({ where: { archivedAt: null, riskCategory: "CRITICAL", riskStatus: { in: ["AT_RISK", "ATTENTION"] } }, orderBy: { riskScore: "desc" }, take: 10, select: { id: true, fullName: true, riskScore: true, lastAttendanceAt: true, phone: true } }),
    db.member.count({ where: { archivedAt: null, riskStatus: "AT_RISK" } }),
    db.membership.findMany({
      // Same "really due" rule as the Renew page (dueForRenewal): not archived, not already renewed another way.
      where: { status: "ACTIVE", endDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 7)) }, renewedTo: { is: null }, member: { archivedAt: null, memberships: { none: { startDate: { gt: toDbDate(today) } } } } },
      include: { member: { select: { id: true, fullName: true, phone: true } }, plan: { select: { name: true } } },
      orderBy: { endDate: "asc" },
      take: 20,
    }),
    db.payment.findMany({ where: { status: "FAILED", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, include: { member: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.recoveryTask.findMany({
      where: { closedAt: null, OR: [{ status: "NOT_CONTACTED" }, { status: "FOLLOW_UP", followUpAt: { lte: now } }] },
      include: { member: { select: { id: true, fullName: true, phone: true } } },
      orderBy: [{ followUpAt: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
    db.marketplaceOrder.count({ where: { status: "PAID" } }),
    db.booking.count({ where: { status: "PENDING" } }),
    db.importJob.findMany({ where: { status: { in: ["NEEDS_REVIEW", "FAILED"] } }, include: { file: { select: { originalName: true } } }, orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  return { critical, inactiveCount: inactive, expiring, failedPayments, followUps, pendingOrders, pendingBookings, importIssues };
}

// ─────────────────────────────── Platform (super admin) ───────────────────────────────

export async function platformOverview(range: Range) {
  // Platform-wide figures count days in Nepal time (NEPAL_TZ is the default).
  const from = startOfLocalDay(range.from);
  const today = todayIn();
  const [gyms, newGyms, archived, members, riskAgg, protectedAgg, subs, gmv, commission, paymentFailures, deadJobs, pendingJobs, webhookFailures, oldestPending, estimate] = await Promise.all([
    prisma.gym.groupBy({ by: ["status"], _count: true }),
    prisma.gym.count({ where: { createdAt: { gte: from } } }),
    prisma.gym.count({ where: { archivedAt: { gte: from } } }),
    prisma.member.groupBy({ by: ["riskStatus"], where: { archivedAt: null }, _count: true }),
    prisma.$queryRaw<{ paisa: bigint | null }[]>`
      SELECT SUM(fee) AS paisa FROM (
        SELECT DISTINCT ON (m."id") (ms."pricePaisa" * 30 / p."durationDays") AS fee
        FROM "Member" m JOIN "Membership" ms ON ms."memberId" = m."id" AND ms."status" = 'ACTIVE' AND ms."endDate" >= ${toDbDate(today)} AND ms."startDate" <= ${toDbDate(today)}
        JOIN "MembershipPlan" p ON p."id" = ms."planId"
        WHERE m."riskStatus" = 'AT_RISK' AND m."archivedAt" IS NULL ORDER BY m."id", ms."endDate" DESC) x`,
    prisma.recoveryTask.aggregate({ _sum: { protectedRevenuePaisa: true }, where: { recoveredAt: { gte: from } } }),
    prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } }, include: { plan: true } }),
    prisma.marketplaceOrder.aggregate({ _sum: { totalPaisa: true }, where: { status: { in: ["PAID", "FULFILLED"] }, paidAt: { gte: from } } }),
    prisma.ledgerEntry.aggregate({ _sum: { amountPaisa: true }, where: { account: "PLATFORM_COMMISSION", createdAt: { gte: from } } }),
    prisma.payment.count({ where: { status: "FAILED", createdAt: { gte: from } } }),
    prisma.job.count({ where: { status: "DEAD" } }),
    prisma.job.count({ where: { status: "PENDING", runAt: { lte: new Date() } } }),
    prisma.paymentWebhookEvent.count({ where: { status: { in: ["REJECTED", "AMOUNT_MISMATCH"] }, receivedAt: { gte: from } } }),
    prisma.job.findFirst({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
    prisma.$queryRaw<{ est: number | null; low: bigint | null; high: bigint | null }[]>`
      SELECT SUM("estimatedLoss") AS est, SUM("lossRangeLow") AS low, SUM("lossRangeHigh") AS high FROM (
        SELECT DISTINCT ON ("gymId") "estimatedLoss", "lossRangeLow", "lossRangeHigh" FROM "PredictionReport"
        WHERE "confidence" <> 'INSUFFICIENT' ORDER BY "gymId", "generatedAt" DESC) x`,
  ]);
  const gymCount = (s: string) => gyms.find((g) => g.status === s)?._count ?? 0;
  const memberCount = (s: string) => members.find((m) => m.riskStatus === s)?._count ?? 0;
  const mrr = subs.reduce((a, s) => a + (s.plan.billingPeriod === "YEARLY" ? Math.round(s.plan.pricePaisa / 12) : s.plan.pricePaisa), 0);
  return {
    range,
    gyms: { total: gyms.reduce((a, g) => a + g._count, 0), active: gymCount("ACTIVE"), trial: gymCount("TRIAL"), suspended: gymCount("SUSPENDED"), archived: gymCount("ARCHIVED"), newInPeriod: newGyms, churnedInPeriod: archived },
    members: { total: members.reduce((a, m) => a + m._count, 0), active: memberCount("ACTIVE") + memberCount("ATTENTION"), atRisk: memberCount("AT_RISK"), lost: memberCount("LOST") },
    actual: {
      revenueAtRiskPaisa: Number(riskAgg[0]?.paisa ?? 0),
      saasMrrPaisa: mrr,
      saasArrPaisa: mrr * 12,
      marketplaceGmvPaisa: gmv._sum.totalPaisa ?? 0,
      platformCommissionPaisa: commission._sum.amountPaisa ?? 0,
      paymentFailures,
    },
    estimated: {
      revenueProtectedPaisa: protectedAgg._sum.protectedRevenuePaisa ?? 0,
      memberLoss: { estimate: estimate[0]?.est ?? null, low: Number(estimate[0]?.low ?? 0), high: Number(estimate[0]?.high ?? 0) },
    },
    system: {
      deadJobs,
      pendingJobs,
      queueLagSeconds: oldestPending ? Math.round((Date.now() - oldestPending.runAt.getTime()) / 1000) : 0,
      webhookFailures,
    },
  };
}
