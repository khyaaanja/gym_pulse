import { prisma } from "@/db/client";
import type { Job } from "@/generated/prisma/client";
import { dispatchNotification, markNotificationFailed } from "@/services/notifications";
import { processImport, commitImport, markImportFailed, purgeExpiredRawFiles } from "@/services/imports/pipeline";
import { recalculateGymRisk, generatePredictionReport, evaluateOutcomes } from "@/services/risk/run";
import { runInactivityAutomation, runRenewalReminders, runDelayedInactivity } from "@/services/automation";
import { expireMemberships } from "@/services/memberships";
import { expireStalePayments } from "@/services/payments/service";
import { expireUnpaidOrders } from "@/services/marketplace";
import { runSubscriptionBilling } from "@/services/billing";
import { streakFrom, streakGap } from "@/services/attendance";
import { fromDbDate, today as todayIn } from "@/lib/time";
import type { AllowedExt } from "@/services/imports/detect";

type P = Record<string, unknown>;
export type HandlerFn = (payload: P, job: Job) => Promise<unknown>;

async function activeGymIds() {
  return (await prisma.gym.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } })).map((g) => g.id);
}

export async function recalcStreaks(gymId: string) {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const today = todayIn(gym.timezone);
  const members = await prisma.member.findMany({ where: { gymId, archivedAt: null }, select: { id: true, bestStreak: true } });
  let updated = 0;
  for (const m of members) {
    const days = (await prisma.attendance.findMany({ where: { memberId: m.id }, select: { localDate: true }, orderBy: { localDate: "asc" } })).map((a) => fromDbDate(a.localDate));
    const s = streakFrom(days, today, streakGap(gym));
    await prisma.member.update({ where: { id: m.id }, data: { currentStreak: s.current, bestStreak: Math.max(s.best, m.bestStreak), totalVisits: days.length } });
    updated++;
  }
  return { updated };
}

export const HANDLERS: Record<string, HandlerFn> = {
  "notification.send": (p) => dispatchNotification(p.notificationId as string),
  "import.process": (p) => processImport(p.jobId as string, p.gymId as string, p.ext as AllowedExt),
  "import.commit": (p) => commitImport(p.jobId as string, p.gymId as string),
  // Daily per-gym: expire memberships, recompute risk, react to new at-risk members.
  "risk.recalculate": async (p) => {
    const gymId = p.gymId as string;
    await expireMemberships(gymId);
    const res = await recalculateGymRisk(gymId);
    const auto = await runInactivityAutomation(gymId, res.transitions);
    return { assessed: res.assessed, transitions: res.transitions.length, ...auto };
  },
  "prediction.generate": async (p) => {
    const r = await generatePredictionReport(p.gymId as string, { source: (p.source as "SCHEDULED" | "MANUAL") ?? "SCHEDULED", createdById: p.createdById as string | undefined });
    return { reportId: r.id, confidence: r.confidence };
  },
  "prediction.evaluate": () => evaluateOutcomes(),
  "automation.renewals": (p) => runRenewalReminders(p.gymId as string),
  "automation.delayed": (p) => runDelayedInactivity(p as never),
  "streaks.recalculate": (p) => recalcStreaks(p.gymId as string),
  "billing.subscriptions": () => runSubscriptionBilling(),
  "maintenance.cleanup": async () => {
    const raw = await purgeExpiredRawFiles();
    const payments = await expireStalePayments();
    const orders = await expireUnpaidOrders();
    const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
    const adminSessions = await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
    const buckets = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
    const jobs = await prisma.job.deleteMany({ where: { status: "SUCCEEDED", finishedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
    return { raw, payments, orders, sessions: sessions.count, adminSessions: adminSessions.count, buckets: buckets.count, jobs: jobs.count };
  },
  // Fan-out jobs enqueue one job per active gym.
  "fanout.daily": async () => {
    const { enqueue } = await import("@/services/jobs");
    const day = new Date().toISOString().slice(0, 10);
    for (const gymId of await activeGymIds()) {
      await enqueue("risk.recalculate", { gymId }, { gymId, idempotencyKey: `risk.recalculate:${gymId}:${day}` });
      await enqueue("streaks.recalculate", { gymId }, { gymId, idempotencyKey: `streaks:${gymId}:${day}`, priority: -1 });
    }
    return { ok: true };
  },
  "fanout.hourly": async () => {
    const { enqueue } = await import("@/services/jobs");
    const hour = new Date().toISOString().slice(0, 13);
    for (const gymId of await activeGymIds()) await enqueue("automation.renewals", { gymId }, { gymId, idempotencyKey: `renewals:${gymId}:${hour}` });
    return { ok: true };
  },
  "fanout.weekly": async () => {
    const { enqueue } = await import("@/services/jobs");
    const week = Math.floor(Date.now() / (7 * 86_400_000));
    for (const gymId of await activeGymIds()) await enqueue("prediction.generate", { gymId, source: "SCHEDULED" }, { gymId, idempotencyKey: `prediction:${gymId}:w${week}` });
    return { ok: true };
  },
};

/** Cleanup when a job is dead-lettered so user-facing records don't stay "in progress" forever. */
export async function onDeadLetter(job: Job) {
  const p = job.payload as P;
  if (job.type === "notification.send") await markNotificationFailed(p.notificationId as string, job.lastError ?? "Delivery failed");
  if (job.type === "import.process" || job.type === "import.commit") await markImportFailed(p.gymId as string, p.jobId as string);
}
