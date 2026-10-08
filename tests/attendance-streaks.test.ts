import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { weekday, type DateOnly } from "@/lib/time";
import { attendanceSummary, checkIn, streakFrom, type CheckInResult } from "@/services/attendance";
import { errCode, json, req, signInStaff, signOut } from "./helpers/route";
import { at, dayRange, gymWithMember, rewardKeys, seedAttendance, seedMilestones } from "./helpers/attendance";

vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
const { GET: getEngagement, POST: postEngagement } = await import("@/app/api/gym/engagement/route");

beforeEach(() => signOut());

type Accepted = Extract<CheckInResult, { status: "accepted" }>;
const accepted = (r: CheckInResult) => {
  expect(r.status).toBe("accepted");
  return r as Accepted;
};
const member = (id: string) => prisma.member.findUniqueOrThrow({ where: { id } });

/** Check in on each local day (noon), in order; returns the last result. */
async function visit(ctx: Awaited<ReturnType<typeof gymWithMember>>, days: DateOnly[], time = "12:00:00") {
  let last!: CheckInResult;
  const results: CheckInResult[] = [];
  for (const d of days) {
    last = await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at(d, ctx.gym.timezone, time) });
    results.push(last);
  }
  return { last, results };
}

describe("streak rule (pure streakFrom)", () => {
  it("counts visits at most `maxGap` days apart, tracks best, and decays to 0 when the last visit is too old", () => {
    expect(streakFrom(["2026-03-01", "2026-03-02", "2026-03-04"], "2026-03-04", 2)).toEqual({ current: 3, best: 3 });
    expect(streakFrom(["2026-03-01", "2026-03-02", "2026-03-05"], "2026-03-05", 2)).toEqual({ current: 1, best: 2 });
    expect(streakFrom(["2026-03-01", "2026-03-02", "2026-03-03"], "2026-03-05", 2)).toEqual({ current: 3, best: 3 });
    expect(streakFrom(["2026-03-01", "2026-03-02", "2026-03-03"], "2026-03-06", 2)).toEqual({ current: 0, best: 3 });
    expect(streakFrom([], "2026-03-06", 2)).toEqual({ current: 0, best: 0 });
    // gap of exactly maxGap holds, maxGap+1 breaks
    expect(streakFrom(["2026-03-01", "2026-03-03"], "2026-03-03", 2).current).toBe(2);
    expect(streakFrom(["2026-03-01", "2026-03-04"], "2026-03-04", 2).current).toBe(1);
  });
});

describe("streaks through check-in (default: one rest day)", () => {
  it("daily visits build the streak and best streak", async () => {
    const ctx = await gymWithMember();
    const { last } = await visit(ctx, dayRange("2026-03-01", 7));
    const r = accepted(last);
    expect([r.streak, r.bestStreak]).toEqual([7, 7]);
    const m = await member(ctx.member.id);
    expect([m.currentStreak, m.bestStreak, m.totalVisits]).toEqual([7, 7, 7]);
  });

  it("every-other-day visits keep the streak (one rest day allowed)", async () => {
    const ctx = await gymWithMember();
    const { last } = await visit(ctx, dayRange("2026-03-01", 5, 2));
    expect(accepted(last).streak).toBe(5);
  });

  it("two rest days break the streak, restart at 1, and best streak is kept", async () => {
    const ctx = await gymWithMember();
    await visit(ctx, ["2026-03-01", "2026-03-02", "2026-03-03"]);
    const r = accepted((await visit(ctx, ["2026-03-06"])).last); // 3 days after the 3rd: 2 rest days
    expect([r.streak, r.bestStreak]).toEqual([1, 3]);
    const m = await member(ctx.member.id);
    expect([m.currentStreak, m.bestStreak]).toEqual([1, 3]);
  });

  it("streakRestDays=0: back-to-back days only", async () => {
    const ctx = await gymWithMember({ engagement: { streakRestDays: 0 } });
    await visit(ctx, ["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect((await member(ctx.member.id)).currentStreak).toBe(3);
    const r = accepted((await visit(ctx, ["2026-03-05"])).last); // one rest day -> broken
    expect([r.streak, r.bestStreak]).toEqual([1, 3]);
  });

  it("streakRestDays=3: a gap of 4 holds, a gap of 5 breaks", async () => {
    const ctx = await gymWithMember({ engagement: { streakRestDays: 3 } });
    expect(accepted((await visit(ctx, ["2026-03-01", "2026-03-05"])).last).streak).toBe(2);
    expect(accepted((await visit(ctx, ["2026-03-10"])).last).streak).toBe(1); // gap 5
    const other = await gymWithMember({ engagement: { streakRestDays: 3 } });
    expect(accepted((await visit(other, ["2026-03-01", "2026-03-05", "2026-03-09"])).last).streak).toBe(3);
  });

  it("the same visits give different streaks under different rest-day settings (the setting is actually read)", async () => {
    const days = ["2026-03-01", "2026-03-04", "2026-03-07"]; // gaps of 3
    const results: number[] = [];
    for (const rest of [0, 1, 2, 3]) {
      const ctx = await gymWithMember({ engagement: { streakRestDays: rest } });
      results.push(accepted((await visit(ctx, days)).last).streak);
    }
    expect(results).toEqual([1, 1, 3, 3]);
  });

  it("attendanceSummary reports the streak as 0 once the last visit is older than the allowed gap", async () => {
    const ctx = await gymWithMember();
    await seedAttendance(ctx.gym.id, ctx.member.id, ["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect((await attendanceSummary(ctx.gym, ctx.member.id, "2026-03-04")).currentStreak).toBe(3);
    expect((await attendanceSummary(ctx.gym, ctx.member.id, "2026-03-05")).currentStreak).toBe(3);
    expect((await attendanceSummary(ctx.gym, ctx.member.id, "2026-03-06")).currentStreak).toBe(0);
    const s = await attendanceSummary(ctx.gym, ctx.member.id, "2026-03-03");
    expect(s.checkedInToday).toBe(true);
    expect(s.maxGap).toBe(2);
  });
});

describe("gym-local day boundaries", () => {
  it("one check-in per LOCAL day in the gym's timezone, not per UTC day", async () => {
    const ctx = await gymWithMember();
    await prisma.gym.update({ where: { id: ctx.gym.id }, data: { timezone: "America/New_York" } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { id: ctx.gym.id } });
    // 23:30 and 00:30 New York are 03:30 and 04:30 UTC the next day: same UTC date, different local dates.
    const a = await checkIn(gym, ctx.member.id, "STAFF", { at: at("2026-05-10", gym.timezone, "23:30:00") });
    const b = await checkIn(gym, ctx.member.id, "STAFF", { at: at("2026-05-11", gym.timezone, "00:30:00") });
    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
    // 00:10 and 23:50 on the same local day are 19+ hours apart in UTC dates: still a duplicate
    const c = await checkIn(gym, ctx.member.id, "STAFF", { at: at("2026-05-11", gym.timezone, "23:50:00") });
    expect(c.status).toBe("duplicate");
    const rows = await prisma.attendance.findMany({ where: { memberId: ctx.member.id }, orderBy: { localDate: "asc" } });
    expect(rows.map((r) => r.localDate.toISOString().slice(0, 10))).toEqual(["2026-05-10", "2026-05-11"]);
  });
});

describe("streak milestones (Bronze 5, Silver 10, Gold 14, Platinum 30)", () => {
  it("each tier is awarded exactly once, at its threshold", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    const days = dayRange("2026-02-01", 30);
    const awardedAt: Record<string, number> = {};
    const { results } = await visit(ctx, days);
    results.forEach((r, i) => accepted(r).newRewards.forEach((n) => (awardedAt[n] = i + 1)));
    expect(awardedAt).toEqual({ Bronze: 5, Silver: 10, Gold: 14, Platinum: 30 });
    const rewards = await prisma.memberReward.findMany({ where: { memberId: ctx.member.id }, include: { milestone: true } });
    expect(rewards.map((r) => r.milestone!.name).sort()).toEqual(["Bronze", "Gold", "Platinum", "Silver"]);
    expect(rewards.every((r) => r.sourceKey === `milestone:${r.milestoneId}` && r.rewardId)).toBe(true);
  });

  it("nothing is awarded one short of a threshold", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    const { last } = await visit(ctx, dayRange("2026-02-01", 4));
    expect(accepted(last).newRewards).toEqual([]);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(0);
  });

  it("a duplicate check-in does not re-award; a broken-then-rebuilt streak does not award the same tier twice", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await visit(ctx, dayRange("2026-02-01", 5));
    expect(await rewardKeys(ctx.member.id)).toHaveLength(1);
    const dup = await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-02-05", ctx.gym.timezone, "18:00:00") });
    expect(dup.status).toBe("duplicate");
    expect(await rewardKeys(ctx.member.id)).toHaveLength(1);
    // break the streak, rebuild to 5 again
    const { last } = await visit(ctx, dayRange("2026-03-01", 5));
    const r = accepted(last);
    expect(r.streak).toBe(5);
    expect(r.newRewards).toEqual([]);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(1);
  });

  it("a pre-existing long streak awards every crossed tier on the next check-in, each once", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await seedAttendance(ctx.gym.id, ctx.member.id, dayRange("2026-02-01", 29));
    const r = accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-02", ctx.gym.timezone) }));
    expect(r.streak).toBe(30);
    expect(r.newRewards.sort()).toEqual(["Bronze", "Gold", "Platinum", "Silver"]);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(4);
  });

  it("inactive milestones are never awarded", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await prisma.milestone.updateMany({ where: { gymId: ctx.gym.id, name: "Bronze" }, data: { active: false } });
    const { last } = await visit(ctx, dayRange("2026-02-01", 5));
    expect(accepted(last).newRewards).toEqual([]);
  });

  it("rewards are scoped per member", async () => {
    const a = await gymWithMember();
    await seedMilestones(a.gym.id);
    const b = await prisma.member.create({ data: { gymId: a.gym.id, memberCode: `B-${a.member.memberCode}`, fullName: "Second", joinedOn: new Date() } });
    await prisma.membership.create({ data: { gymId: a.gym.id, memberId: b.id, planId: a.plan.id, startDate: new Date("2020-01-01"), endDate: new Date("2040-01-01"), pricePaisa: 1, status: "ACTIVE" } });
    await visit(a, dayRange("2026-02-01", 5));
    await visit({ ...a, member: b }, dayRange("2026-02-01", 5));
    expect(await prisma.memberReward.count({ where: { memberId: a.member.id } })).toBe(1);
    expect(await prisma.memberReward.count({ where: { memberId: b.id } })).toBe(1);
  });
});

describe("total-visit milestones (Club 50, Club 100)", () => {
  it("Club 50 on the 50th visit only", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await prisma.member.update({ where: { id: ctx.member.id }, data: { totalVisits: 48 } });
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-01", ctx.gym.timezone) })).newRewards).toEqual([]); // 49th
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-02", ctx.gym.timezone) })).newRewards).toEqual(["50 visits"]); // 50th
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-03", ctx.gym.timezone) })).newRewards).toEqual([]); // 51st
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(1);
  });

  it("Club 100 on the 100th visit; a member who is past 50 and never got it is awarded Club 50 too, once", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await prisma.member.update({ where: { id: ctx.member.id }, data: { totalVisits: 99 } });
    const r = accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-01", ctx.gym.timezone) }));
    expect(r.newRewards.sort()).toEqual(["100 visits", "50 visits"]);
    accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-02", ctx.gym.timezone) }));
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(2);
  });
});

describe("monthly challenges", () => {
  async function challenge(gymId: string, data: { name: string; kind: "VISITS_IN_MONTH" | "WEEKEND_VISITS" | "EARLY_BIRD" | "STREAK_DAYS"; target: number; config?: object; active?: boolean }) {
    const reward = await prisma.reward.create({ data: { gymId, name: `${data.name} prize`, kind: "BADGE" } });
    return prisma.challenge.create({ data: { gymId, name: data.name, kind: data.kind, target: data.target, config: data.config ?? {}, rewardId: reward.id, active: data.active ?? true } });
  }
  const progress = (challengeId: string, memberId: string, period: string) => prisma.challengeProgress.findUnique({ where: { challengeId_memberId_period: { challengeId, memberId, period } } });

  it("visit-count challenge: progress per visit, completes and rewards exactly at the target, once per month", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "3 visits", kind: "VISITS_IN_MONTH", target: 3 });
    const { results } = await visit(ctx, ["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-08"]);
    expect(results.map((r) => accepted(r).newRewards)).toEqual([[], [], ["3 visits"], []]);
    const p = (await progress(c.id, ctx.member.id, "2026-03"))!;
    expect(p.progress).toBe(4);
    expect(p.completedAt).not.toBeNull();
    expect(await rewardKeys(ctx.member.id)).toEqual([`challenge:${c.id}:2026-03`]);
    // dup check-in same day changes nothing
    await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-03-08", ctx.gym.timezone, "20:00:00") });
    expect((await progress(c.id, ctx.member.id, "2026-03"))!.progress).toBe(4);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(1);
    // next month is a fresh period with its own reward
    await visit(ctx, ["2026-04-02", "2026-04-04", "2026-04-06"]);
    expect(await rewardKeys(ctx.member.id)).toEqual([`challenge:${c.id}:2026-03`, `challenge:${c.id}:2026-04`]);
    expect((await progress(c.id, ctx.member.id, "2026-04"))!.progress).toBe(3);
  });

  it("an incomplete challenge has progress but no completedAt and no reward", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "5 visits", kind: "VISITS_IN_MONTH", target: 5 });
    await visit(ctx, ["2026-03-02", "2026-03-03"]);
    const p = (await progress(c.id, ctx.member.id, "2026-03"))!;
    expect([p.progress, p.completedAt]).toEqual([2, null]);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(0);
  });

  it("only visits inside the calendar month count", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "3 visits", kind: "VISITS_IN_MONTH", target: 3 });
    await visit(ctx, ["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect((await progress(c.id, ctx.member.id, "2026-03"))!.progress).toBe(1);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(0);
  });

  it("weekend challenge counts Saturdays only (Nepal weekly holiday)", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "Sat x3", kind: "WEEKEND_VISITS", target: 3, config: { weekendDays: [6] } });
    const sats = ["2026-03-07", "2026-03-14", "2026-03-21"];
    expect(sats.map(weekday)).toEqual([6, 6, 6]);
    const { results } = await visit(ctx, ["2026-03-07", "2026-03-08" /* Sunday */, "2026-03-09", "2026-03-14"]);
    expect(results.every((r) => r.status === "accepted")).toBe(true);
    expect((await progress(c.id, ctx.member.id, "2026-03"))!.progress).toBe(2);
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(0);
    const last = accepted((await visit(ctx, ["2026-03-21"])).last);
    expect(last.newRewards).toEqual(["Sat x3"]);
    expect((await progress(c.id, ctx.member.id, "2026-03"))!.progress).toBe(3);
  });

  it("early-bird counts only check-ins before the cut-off hour in the GYM's timezone", async () => {
    const ctx = await gymWithMember();
    await prisma.gym.update({ where: { id: ctx.gym.id }, data: { timezone: "America/New_York" } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { id: ctx.gym.id } });
    const c = await challenge(gym.id, { name: "Early", kind: "EARLY_BIRD", target: 3, config: { beforeHour: 7 } });
    const go = (d: DateOnly, t: string) => checkIn(gym, ctx.member.id, "STAFF", { at: at(d, gym.timezone, t) });
    // 06:30 New York = 10:30 UTC (not "early" in UTC); 07:30 New York = 11:30 UTC
    expect(accepted(await go("2026-05-04", "06:30:00")).newRewards).toEqual([]);
    expect(accepted(await go("2026-05-05", "07:30:00")).newRewards).toEqual([]);
    expect(accepted(await go("2026-05-06", "06:59:00")).newRewards).toEqual([]);
    expect((await progress(c.id, ctx.member.id, "2026-05"))!.progress).toBe(2);
    expect(accepted(await go("2026-05-07", "05:00:00")).newRewards).toEqual(["Early"]);
    expect((await progress(c.id, ctx.member.id, "2026-05"))!.progress).toBe(3);
    // exactly 07:00:00 is not before 7
    const other = await gymWithMember();
    await prisma.gym.update({ where: { id: other.gym.id }, data: { timezone: "America/New_York" } });
    await prisma.challenge.create({ data: { gymId: other.gym.id, name: "E", kind: "EARLY_BIRD", target: 1, config: { beforeHour: 7 } } });
    const og = await prisma.gym.findUniqueOrThrow({ where: { id: other.gym.id } });
    expect(accepted(await checkIn(og, other.member.id, "STAFF", { at: at("2026-05-04", og.timezone, "07:00:00") })).newRewards).toEqual([]);
  });

  it("early-bird defaults to 7 AM when the config has no beforeHour", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "Early", kind: "EARLY_BIRD", target: 1 });
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-05-04", ctx.gym.timezone, "08:00:00") })).newRewards).toEqual([]);
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-05-05", ctx.gym.timezone, "06:00:00") })).newRewards).toEqual(["Early"]);
    expect(c.config).toEqual({});
  });

  it("streak challenge uses the all-time period, rewards once, and does not re-award after a break", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "Streak 3", kind: "STREAK_DAYS", target: 3 });
    const r = accepted((await visit(ctx, ["2026-03-01", "2026-03-02", "2026-03-03"])).last);
    expect(r.newRewards).toEqual(["Streak 3"]);
    expect(await rewardKeys(ctx.member.id)).toEqual([`challenge:${c.id}:all`]);
    await visit(ctx, ["2026-04-01", "2026-04-02", "2026-04-03"]); // broke, rebuilt
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(1);
  });

  it("inactive challenges track nothing", async () => {
    const ctx = await gymWithMember();
    const c = await challenge(ctx.gym.id, { name: "Off", kind: "VISITS_IN_MONTH", target: 1, active: false });
    expect(accepted((await visit(ctx, ["2026-03-02"])).last).newRewards).toEqual([]);
    expect(await progress(c.id, ctx.member.id, "2026-03")).toBeNull();
    expect(await prisma.memberReward.count({ where: { memberId: ctx.member.id } })).toBe(0);
  });

  it("two members completing the same challenge each get their own reward", async () => {
    const a = await gymWithMember();
    const c = await challenge(a.gym.id, { name: "1 visit", kind: "VISITS_IN_MONTH", target: 1 });
    const b = await prisma.member.create({ data: { gymId: a.gym.id, memberCode: `B-${a.member.memberCode}`, fullName: "Second", joinedOn: new Date() } });
    await prisma.membership.create({ data: { gymId: a.gym.id, memberId: b.id, planId: a.plan.id, startDate: new Date("2020-01-01"), endDate: new Date("2040-01-01"), pricePaisa: 1, status: "ACTIVE" } });
    await visit(a, ["2026-03-02"]);
    await visit({ ...a, member: b }, ["2026-03-02"]);
    expect(await prisma.memberReward.count({ where: { sourceKey: `challenge:${c.id}:2026-03` } })).toBe(2);
  });

  it("attendanceSummary reports challenge progress (capped at target), completion and milestone achievement", async () => {
    const ctx = await gymWithMember();
    await seedMilestones(ctx.gym.id);
    await challenge(ctx.gym.id, { name: "3 visits", kind: "VISITS_IN_MONTH", target: 3 });
    await visit(ctx, dayRange("2026-03-01", 5));
    const s = await attendanceSummary(ctx.gym, ctx.member.id, "2026-03-05");
    expect(s.challenges[0]).toMatchObject({ name: "3 visits", progress: 3, completed: true });
    expect(s.milestones.find((m) => m.name === "Bronze")!.achieved).toBe(true);
    expect(s.milestones.find((m) => m.name === "Silver")!.achieved).toBe(false);
    expect(s.nextMilestone).toMatchObject({ name: "Silver", remaining: 5 });
    expect([s.currentStreak, s.monthlyVisits, s.totalVisits]).toEqual([5, 5, 5]);
  });
});

describe("engagement config (/api/gym/engagement)", () => {
  const post = (body: unknown) => postEngagement(req("/api/gym/engagement", { body }));

  it("owners can create rewards, milestones and challenges; they appear in GET", async () => {
    const { gym } = await gymWithMember();
    await signInStaff(gym.id, "OWNER");
    const reward = await json<{ id: string }>(await post({ type: "reward", name: "Free shake", kind: "FREE_SESSION", value: 1 }));
    const ms = await post({ type: "milestone", name: "Bronze", tier: "Bronze", kind: "STREAK", threshold: 5, rewardId: reward.id });
    expect(ms.status).toBe(200);
    const ch = await json<{ id: string; config: { beforeHour?: number } }>(await post({ type: "challenge", name: "Early", kind: "EARLY_BIRD", target: 4, rewardId: reward.id, beforeHour: 9 }));
    expect(ch.config).toEqual({ beforeHour: 9 });
    const wk = await json<{ config: { weekendDays?: number[] } }>(await post({ type: "challenge", name: "Sat", kind: "WEEKEND_VISITS", target: 2 }));
    expect(wk.config).toEqual({ weekendDays: [6] });
    const list = await json<{ challenges: unknown[]; milestones: { threshold: number }[]; rewards: unknown[] }>(await getEngagement(req("/api/gym/engagement")));
    expect([list.challenges.length, list.milestones.map((m) => m.threshold), list.rewards.length]).toEqual([2, [5], 1]);
  });

  it("a challenge configured with beforeHour 9 really uses 9 (config round-trips into behaviour)", async () => {
    const ctx = await gymWithMember();
    await signInStaff(ctx.gym.id, "OWNER");
    await post({ type: "challenge", name: "Early9", kind: "EARLY_BIRD", target: 1, beforeHour: 9 });
    signOut();
    expect(accepted(await checkIn(ctx.gym, ctx.member.id, "STAFF", { at: at("2026-05-05", ctx.gym.timezone, "08:30:00") })).newRewards).toEqual(["Early9"]);
  });

  it("staff cannot change configuration (403) but can read it; trainers likewise", async () => {
    const { gym } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    expect((await post({ type: "reward", name: "Nope", kind: "BADGE" })).status).toBe(403);
    expect((await getEngagement(req("/api/gym/engagement"))).status).toBe(200);
    expect(await prisma.reward.count({ where: { gymId: gym.id } })).toBe(0);
    expect((await postEngagement(req("/api/gym/engagement", { body: { type: "reward", name: "Nope", kind: "BADGE" } }))).status).toBe(403);
  });

  it("anonymous -> 401; invalid bodies -> 400; foreign reward id -> 400; duplicate milestone threshold -> error", async () => {
    const a = await gymWithMember();
    const b = await gymWithMember();
    const foreign = await prisma.reward.create({ data: { gymId: b.gym.id, name: "Theirs", kind: "BADGE" } });
    expect((await post({ type: "reward", name: "x", kind: "BADGE" })).status).toBe(401);
    await signInStaff(a.gym.id, "OWNER");
    expect((await post({ type: "challenge", name: "Zero", kind: "VISITS_IN_MONTH", target: 0 })).status).toBe(400);
    expect((await post({ type: "milestone", name: "M", tier: "T", kind: "STREAK", threshold: 5001 })).status).toBe(400);
    expect((await post({ type: "milestone", name: "M", tier: "T", kind: "STREAK", threshold: 5, rewardId: foreign.id })).status).toBe(400);
    expect(await prisma.milestone.count({ where: { gymId: a.gym.id } })).toBe(0);
    expect((await post({ type: "milestone", name: "M1", tier: "T", kind: "STREAK", threshold: 5 })).status).toBe(200);
    const dup = await post({ type: "milestone", name: "M2", tier: "T", kind: "STREAK", threshold: 5 });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.status).toBeLessThan(500);
    expect(await prisma.milestone.count({ where: { gymId: a.gym.id } })).toBe(1);
  });

  it("cannot update another gym's milestone by id", async () => {
    const a = await gymWithMember();
    const b = await gymWithMember();
    const theirs = await prisma.milestone.create({ data: { gymId: b.gym.id, name: "Theirs", tier: "T", kind: "STREAK", threshold: 7 } });
    await signInStaff(a.gym.id, "OWNER");
    const res = await post({ type: "milestone", id: theirs.id, name: "Hijacked", tier: "T", kind: "STREAK", threshold: 7 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe("Theirs");
  });

  it("updating a milestone threshold changes when it is awarded", async () => {
    const ctx = await gymWithMember();
    await signInStaff(ctx.gym.id, "OWNER");
    const m = await json<{ id: string }>(await post({ type: "milestone", name: "Quick", tier: "T", kind: "STREAK", threshold: 2 }));
    await post({ type: "milestone", id: m.id, name: "Quick", tier: "T", kind: "STREAK", threshold: 3 });
    signOut();
    expect(accepted((await visit(ctx, ["2026-03-01", "2026-03-02"])).last).newRewards).toEqual([]);
    expect(accepted((await visit(ctx, ["2026-03-03"])).last).newRewards).toEqual(["Quick"]);
  });

  it("is blocked when the streaks feature is off for the gym", async () => {
    const { gym } = await gymWithMember();
    await prisma.featureFlag.create({ data: { key: "streaks", scope: "GYM", scopeId: gym.id, enabled: false } });
    await signInStaff(gym.id, "OWNER");
    const res = await post({ type: "reward", name: "x1", kind: "BADGE" });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("feature_disabled");
    expect((await getEngagement(req("/api/gym/engagement"))).status).toBe(403);
  });
});
