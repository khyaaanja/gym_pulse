import { prisma } from "@/db/client";
import { tenantDb, type TenantDb } from "@/db/tenant";
import { gymSettings } from "@/config/gym-settings";
import { signPayload, verifyPayload } from "@/lib/crypto";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { diffDays, fromDbDate, localDate, localHour, monthKey, toDbDate, weekday, addDays, type DateOnly } from "@/lib/time";
import type { CheckInMethod, Gym, Member } from "@/generated/prisma/client";
import { activeMembership } from "./memberships";
import { onMemberReturned } from "./recovery";
import { onMilestoneReached } from "./automation";
import { memberScope, type Viewer } from "@/lib/scope";

/** One day's check-ins at the desk, newest first — only members the viewer may see (trainers: their own members). */
export async function checkInsOn(viewer: Viewer & { db: TenantDb }, day: DateOnly, take = 100) {
  return viewer.db.attendance.findMany({
    where: { localDate: toDbDate(day), member: memberScope(viewer) },
    include: { member: { select: { id: true, fullName: true, memberCode: true, currentStreak: true } }, location: { select: { name: true } } },
    orderBy: { checkedInAt: "desc" },
    take,
  });
}

/** A streak continues while consecutive visits are at most `maxGap` days apart (one rest day by default). */
export const STREAK_MAX_GAP_DAYS = 2;
/** The gym's streak rule: allowed rest days + 1 = the largest gap between visits that keeps a streak. */
export const streakGap = (gym: Pick<Gym, "settings">) => gymSettings(gym.settings).engagement.streakRestDays + 1;

export type CheckInResult =
  | { status: "accepted"; attendanceId: string; streak: number; bestStreak: number; newRewards: string[]; warning?: string }
  | { status: "duplicate"; message: string };

/**
 * One attendance per member per gym-local day. The unique index (memberId, localDate) is the
 * source of truth, so concurrent double-taps can't create two records.
 */
export async function checkIn(
  gym: Gym,
  memberId: string,
  method: CheckInMethod,
  opts: { recordedById?: string; deviceId?: string; locationId?: string; at?: Date } = {},
): Promise<CheckInResult> {
  const db = tenantDb(gym.id);
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member || member.archivedAt) throw notFound("Member not found.");
  if (member.status === "SUSPENDED") throw forbidden("This membership is suspended.");

  const at = opts.at ?? new Date();
  const day = localDate(at, gym.timezone);
  const settings = gymSettings(gym.settings);
  let warning: string | undefined;
  const active = await activeMembership(db, memberId, day);
  if (!active) {
    const latest = await db.membership.findFirst({ where: { memberId }, orderBy: { endDate: "desc" } });
    const lapsedDays = latest ? diffDays(fromDbDate(latest.endDate), day) : null;
    const withinGrace = lapsedDays !== null && lapsedDays <= settings.renewal.gracePeriodDays;
    if (settings.attendance.requireActiveMembership && !withinGrace) {
      await db.checkIn.create({ data: { gymId: gym.id, memberId, method, outcome: "REJECTED", reason: "No active membership", recordedById: opts.recordedById, deviceId: opts.deviceId } });
      throw badRequest(latest ? "Membership has expired. Please renew to check in." : "No active membership. Please choose a plan first.");
    }
    warning = withinGrace ? `Membership expired ${lapsedDays} day${lapsedDays === 1 ? "" : "s"} ago — within the ${settings.renewal.gracePeriodDays}-day grace period.` : undefined;
  }

  let attendanceId: string;
  try {
    const a = await db.attendance.create({
      data: { gymId: gym.id, memberId, localDate: toDbDate(day), checkedInAt: at, method, recordedById: opts.recordedById, locationId: opts.locationId },
    });
    attendanceId = a.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      await db.checkIn.create({ data: { gymId: gym.id, memberId, method, outcome: "DUPLICATE", reason: "Already checked in today", recordedById: opts.recordedById, deviceId: opts.deviceId } });
      return { status: "duplicate", message: `${member.fullName.split(" ")[0]} is already checked in today.` };
    }
    throw err;
  }
  await db.checkIn.create({ data: { gymId: gym.id, memberId, method, outcome: "ACCEPTED", recordedById: opts.recordedById, deviceId: opts.deviceId } });

  const { current, best } = await refreshStreak(db, member, day, streakGap(gym));
  const wasAtRisk = member.riskStatus === "AT_RISK" || member.riskStatus === "ATTENTION";
  await db.member.update({
    where: { id: memberId },
    data: {
      lastAttendanceAt: at,
      totalVisits: { increment: 1 },
      currentStreak: current,
      bestStreak: Math.max(best, member.bestStreak),
      ...(wasAtRisk && active ? { riskStatus: "ACTIVE" } : {}),
    },
  });
  if (wasAtRisk && active) {
    await db.riskHistory.create({
      data: { gymId: gym.id, memberId, fromStatus: member.riskStatus, toStatus: "ACTIVE", reason: "Member checked in" },
    });
  }
  await onMemberReturned(gym.id, memberId, at);
  const newRewards = await evaluateEngagement(gym, { ...member, currentStreak: current, totalVisits: member.totalVisits + 1 }, day, at);
  return { status: "accepted", attendanceId, streak: current, bestStreak: Math.max(best, member.bestStreak), newRewards, warning };
}

async function refreshStreak(db: TenantDb, member: Member, today: DateOnly, maxGap: number) {
  const recent = await db.attendance.findMany({
    where: { memberId: member.id, localDate: { gte: toDbDate(addDays(today, -400)) } },
    select: { localDate: true },
    orderBy: { localDate: "asc" },
  });
  return streakFrom(recent.map((r) => fromDbDate(r.localDate)), today, maxGap);
}

/** Clean restatement used everywhere: current streak is the run ending at the last visit, if that visit is recent enough. */
export function streakFrom(daysAsc: DateOnly[], today: DateOnly, maxGap = STREAK_MAX_GAP_DAYS) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < daysAsc.length; i++) {
    run = i > 0 && diffDays(daysAsc[i - 1]!, daysAsc[i]!) <= maxGap ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = daysAsc.at(-1);
  const current = last !== undefined && diffDays(last, today) <= maxGap ? run : 0;
  return { current, best };
}

/** Milestones (streak / total visits) and monthly challenges. Awards are idempotent per source key. */
async function evaluateEngagement(gym: Gym, member: Member, day: DateOnly, at: Date): Promise<string[]> {
  const db = tenantDb(gym.id);
  const awarded: string[] = [];
  const milestones = await db.milestone.findMany({ where: { active: true } });
  for (const m of milestones) {
    const value = m.kind === "STREAK" ? member.currentStreak : member.totalVisits;
    if (value < m.threshold) continue;
    const sourceKey = `milestone:${m.id}`;
    const exists = await db.memberReward.findUnique({ where: { memberId_sourceKey: { memberId: member.id, sourceKey } } });
    if (exists) continue;
    try {
      const reward = await db.memberReward.create({ data: { gymId: gym.id, memberId: member.id, milestoneId: m.id, rewardId: m.rewardId, sourceKey } });
      awarded.push(m.name);
      await onMilestoneReached(gym.id, member.id, m.name, reward.id);
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }

  const month = monthKey(day);
  const challenges = await db.challenge.findMany({ where: { active: true } });
  if (challenges.length) {
    const monthVisits = await db.attendance.findMany({
      where: { memberId: member.id, localDate: { gte: toDbDate(`${month}-01`), lte: toDbDate(day) } },
      select: { localDate: true, checkedInAt: true },
    });
    for (const c of challenges) {
      const cfg = (c.config ?? {}) as { beforeHour?: number; weekendDays?: number[] };
      let progress = 0;
      let period = month;
      switch (c.kind) {
        case "VISITS_IN_MONTH":
          progress = monthVisits.length;
          break;
        case "STREAK_DAYS":
          progress = member.currentStreak;
          period = "all";
          break;
        case "WEEKEND_VISITS": {
          const days = cfg.weekendDays ?? [6]; // Saturday is the weekly holiday in Nepal
          progress = monthVisits.filter((v) => days.includes(weekday(fromDbDate(v.localDate)))).length;
          break;
        }
        case "EARLY_BIRD": {
          const before = cfg.beforeHour ?? 7;
          progress = monthVisits.filter((v) => localHour(v.checkedInAt, gym.timezone) < before).length;
          break;
        }
      }
      const done = progress >= c.target;
      const row = await db.challengeProgress.upsert({
        where: { challengeId_memberId_period: { challengeId: c.id, memberId: member.id, period } },
        create: { gymId: gym.id, challengeId: c.id, memberId: member.id, period, progress, completedAt: done ? at : null },
        update: { progress },
      });
      if (done && !row.completedAt) {
        await db.challengeProgress.update({ where: { id: row.id }, data: { completedAt: at } });
      }
      if (done) {
        const sourceKey = `challenge:${c.id}:${period}`;
        const exists = await db.memberReward.findUnique({ where: { memberId_sourceKey: { memberId: member.id, sourceKey } } });
        if (!exists) {
          try {
            const reward = await db.memberReward.create({ data: { gymId: gym.id, memberId: member.id, rewardId: c.rewardId, sourceKey } });
            awarded.push(c.name);
            await onMilestoneReached(gym.id, member.id, c.name, reward.id);
          } catch (err) {
            if ((err as { code?: string }).code !== "P2002") throw err;
          }
        }
      }
    }
  }
  return awarded;
}

// ─────────────────────────────── QR tokens ───────────────────────────────

/** Rotating kiosk QR shown at the front desk. Members scan it with their phone camera. */
export function kioskToken(gym: Gym, now = Date.now(), locationId?: string | null) {
  const rotate = gymSettings(gym.settings).attendance.kioskQrRotateSeconds;
  const window = Math.floor(now / 1000 / rotate);
  return { token: signPayload({ k: "kiosk", g: gym.id, w: window, ...(locationId ? { l: locationId } : {}) }), expiresInSeconds: rotate - (Math.floor(now / 1000) % rotate) };
}

/** The branch a kiosk code was shown at (signed into the token), if any. Only meaningful after verifyKioskToken. */
export function kioskTokenLocation(token: string): string | null {
  return verifyPayload<{ l?: string }>(token)?.l ?? null;
}

export function verifyKioskToken(gym: Gym, token: string, now = Date.now()): boolean {
  const p = verifyPayload<{ k: string; g: string; w: number }>(token);
  if (!p || p.k !== "kiosk" || p.g !== gym.id) return false;
  const rotate = gymSettings(gym.settings).attendance.kioskQrRotateSeconds;
  const window = Math.floor(now / 1000 / rotate);
  return p.w === window || p.w === window - 1; // one window of grace for slow scans
}

/** Member's personal QR (shown in the app) for staff to scan. Valid for 5 minutes. */
export function memberPassToken(member: Pick<Member, "id" | "gymId">, now = Date.now()) {
  return signPayload({ k: "pass", m: member.id, g: member.gymId, t: Math.floor(now / 1000) });
}

export function verifyMemberPass(gymId: string, token: string, now = Date.now()): string | null {
  const p = verifyPayload<{ k: string; m: string; g: string; t: number }>(token);
  if (!p || p.k !== "pass" || p.g !== gymId) return null;
  if (Math.floor(now / 1000) - p.t > 300) return null;
  return p.m;
}

/** Summary for the member's Attendance screen. */
export async function attendanceSummary(gym: Gym, memberId: string, today: DateOnly) {
  const db = tenantDb(gym.id);
  const since = addDays(today, -120);
  const [member, visits, challenges, rewards, milestones] = await Promise.all([
    db.member.findUniqueOrThrow({ where: { id: memberId } }),
    db.attendance.findMany({ where: { memberId, localDate: { gte: toDbDate(since) } }, select: { localDate: true, checkedInAt: true }, orderBy: { localDate: "asc" } }),
    db.challenge.findMany({ where: { active: true }, include: { progress: { where: { memberId } }, reward: true } }),
    db.memberReward.findMany({ where: { memberId }, include: { reward: true, milestone: true }, orderBy: { awardedAt: "desc" }, take: 20 }),
    db.milestone.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { threshold: "asc" }], include: { reward: true } }),
  ]);
  const days = visits.map((v) => fromDbDate(v.localDate));
  const maxGap = streakGap(gym);
  const { current } = streakFrom(days, today, maxGap);
  const weekStart = addDays(today, -((weekday(today) + 1) % 7)); // weeks start Sunday in Nepal
  const nextStreakMilestone = milestones.find((m) => m.kind === "STREAK" && m.threshold > current);
  return {
    today,
    maxGap,
    checkedInToday: days.at(-1) === today,
    currentStreak: current,
    bestStreak: Math.max(member.bestStreak, current),
    totalVisits: member.totalVisits,
    weeklyVisits: days.filter((d) => d >= weekStart).length,
    monthlyVisits: days.filter((d) => monthKey(d) === monthKey(today)).length,
    calendar: days,
    nextMilestone: nextStreakMilestone
      ? { name: nextStreakMilestone.name, tier: nextStreakMilestone.tier, remaining: nextStreakMilestone.threshold - current, threshold: nextStreakMilestone.threshold }
      : null,
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      tier: m.tier,
      kind: m.kind,
      threshold: m.threshold,
      reward: m.reward?.name ?? null,
      achieved: rewards.some((r) => r.milestoneId === m.id),
    })),
    challenges: challenges.map((c) => {
      const period = c.kind === "STREAK_DAYS" ? "all" : monthKey(today);
      const p = c.progress.find((x) => x.period === period);
      return { id: c.id, name: c.name, description: c.description, kind: c.kind, target: c.target, progress: Math.min(p?.progress ?? 0, c.target), completed: !!p?.completedAt, reward: c.reward?.name ?? null };
    }),
    rewards: rewards.map((r) => ({ id: r.id, name: r.reward?.name ?? r.milestone?.name ?? "Reward", kind: r.reward?.kind ?? "BADGE", awardedAt: r.awardedAt, redeemedAt: r.redeemedAt })),
  };
}

export async function gymForDevice(keyHash: string) {
  const device = await prisma.checkInDevice.findUnique({ where: { keyHash }, include: { gym: true } });
  if (!device || !device.active) return null;
  return device;
}
