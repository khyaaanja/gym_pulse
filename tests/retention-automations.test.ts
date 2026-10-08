import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { json, req, signInStaff, signOut, makeUser } from "./helpers/route";
import { day, ensurePlatformRules, seedMember } from "./helpers/retention";
import { makeGym } from "./helpers/fixtures";
import { formatDate, toDbDate } from "@/lib/time";
import { checkIn } from "@/services/attendance";

const { HANDLERS } = await import("@/workers/handlers");
const { GET: getRules, PUT: putRule } = await import("@/app/api/gym/automations/route");

beforeAll(ensurePlatformRules);
beforeEach(() => signOut());

const run = (type: string, payload: Record<string, unknown>) => HANDLERS[type]!(payload, {} as never);
const put = (body: unknown) => putRule(req("/api/gym/automations", { method: "PUT", body }));

async function memberWithLogin(gymId: string, planId: string, o: NonNullable<Parameters<typeof seedMember>[2]>) {
  const user = await makeUser("Member login");
  return { user, ...(await seedMember(gymId, planId, { ...o, userId: user.id })) };
}
const memberNotes = (memberId: string) => prisma.notification.findMany({ where: { memberId }, orderBy: { createdAt: "asc" } });

describe("inactivity automation (risk.recalculate)", () => {
  it("new AT_RISK member: one recovery task, one staff alert per staff; nudge waits for 14 days; rerun is a no-op", async () => {
    const { gym, plan } = await makeGym();
    const { user: owner } = await signInStaff(gym.id, "OWNER");
    await signInStaff(gym.id, "TRAINER"); // trainers are not in the alert audience
    const m = await memberWithLogin(gym.id, plan.id, { daysAgo: 12, pricePaisa: 150_000 });
    const res = (await run("risk.recalculate", { gymId: gym.id })) as { transitions: number; flagged: number };
    expect(res.transitions).toBe(1);
    expect(res.flagged).toBe(1);
    const task = await prisma.recoveryTask.findFirstOrThrow({ where: { memberId: m.member.id } });
    expect(task.reason).toBe("12 days without a visit");
    expect(task.monthlyFeePaisa).toBe(150_000);
    const staffNotes = await prisma.notification.findMany({ where: { gymId: gym.id, category: "AT_RISK" } });
    expect(staffNotes).toHaveLength(1); // owner only
    expect(staffNotes[0]!.userId).toBe(owner.id);
    expect(staffNotes[0]!.status).toBe("SENT");
    expect(staffNotes[0]!.body).toContain(m.member.fullName);
    expect(await memberNotes(m.member.id)).toHaveLength(0); // below the 14-day minimum
    await run("risk.recalculate", { gymId: gym.id });
    await run("risk.recalculate", { gymId: gym.id });
    expect(await prisma.notification.count({ where: { gymId: gym.id, category: "AT_RISK" } })).toBe(1);
    expect(await prisma.recoveryTask.count({ where: { memberId: m.member.id } })).toBe(1);
    expect(await prisma.automationRun.count({ where: { gymId: gym.id } })).toBe(1);
  });

  it("delay 0: a member 15 days away is nudged immediately in-app (SENT) and by SMS (SKIPPED: no provider)", async () => {
    const { gym, plan } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    const m = await memberWithLogin(gym.id, plan.id, { daysAgo: 15 });
    await run("risk.recalculate", { gymId: gym.id });
    const notes = await memberNotes(m.member.id);
    const inApp = notes.find((n) => n.channel === "IN_APP")!;
    const sms = notes.find((n) => n.channel === "SMS")!;
    expect(notes).toHaveLength(2);
    expect(inApp.status).toBe("SENT");
    expect(inApp.userId).toBe(m.user.id);
    expect(inApp.category).toBe("INACTIVITY");
    expect(inApp.body).toContain("15");
    expect(sms.status).toBe("SKIPPED");
    expect(sms.error).toMatch(/provider/i);
    expect(await prisma.job.count({ where: { gymId: gym.id, type: "automation.delayed" } })).toBe(0);
  });

  it("delay > 0: enqueues automation.delayed, sends nothing yet; the handler then sends exactly once even if run repeatedly or concurrently", async () => {
    const { gym, plan } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    expect((await put({ op: "override", key: "inactive-member-nudge", enabled: true, delayMinutes: 120, channels: ["IN_APP"] })).status).toBe(200);
    const m = await memberWithLogin(gym.id, plan.id, { daysAgo: 15 });
    const before = Date.now();
    await run("risk.recalculate", { gymId: gym.id });
    expect(await memberNotes(m.member.id)).toHaveLength(0);
    const jobs = await prisma.job.findMany({ where: { gymId: gym.id, type: "automation.delayed" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("PENDING");
    expect(jobs[0]!.runAt.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000 - 1000);
    expect(jobs[0]!.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 120 * 60_000 + 1000);
    // A second recalculation in the same at-risk episode doesn't queue another job.
    await run("risk.recalculate", { gymId: gym.id });
    expect(await prisma.job.count({ where: { gymId: gym.id, type: "automation.delayed" } })).toBe(1);

    const payload = jobs[0]!.payload as Record<string, unknown>;
    await Promise.all([run("automation.delayed", payload), run("automation.delayed", payload)]);
    await run("automation.delayed", payload);
    const notes = await memberNotes(m.member.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ channel: "IN_APP", status: "SENT", category: "INACTIVITY", userId: m.user.id });
    expect(notes[0]!.dedupeKey).toBe(`inactivity:${m.member.id}:${payload.episode}:IN_APP`);
  });

  it("delayed job does nothing if the member came back, or the rule was disabled meanwhile", async () => {
    const { gym, plan } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    await put({ op: "override", key: "inactive-member-nudge", enabled: true, delayMinutes: 30, channels: ["IN_APP"] });
    const back = await memberWithLogin(gym.id, plan.id, { daysAgo: 15 });
    const stay = await memberWithLogin(gym.id, plan.id, { daysAgo: 16 });
    await run("risk.recalculate", { gymId: gym.id });
    const jobs = await prisma.job.findMany({ where: { gymId: gym.id, type: "automation.delayed" } });
    expect(jobs).toHaveLength(2);
    await checkIn(gym, back.member.id, "STAFF");
    await put({ op: "override", key: "inactive-member-nudge", enabled: false, delayMinutes: 30, channels: ["IN_APP"] });
    for (const j of jobs) await run("automation.delayed", j.payload as Record<string, unknown>);
    expect(await memberNotes(back.member.id)).toHaveLength(0);
    expect(await memberNotes(stay.member.id)).toHaveLength(0);
    // Re-enable: the still-at-risk member now gets the message from the same job payload.
    await put({ op: "override", key: "inactive-member-nudge", enabled: true, delayMinutes: 30, channels: ["IN_APP"] });
    const stayJob = jobs.find((j) => (j.payload as { memberId: string }).memberId === stay.member.id)!;
    const out = (await run("automation.delayed", stayJob.payload as Record<string, unknown>)) as { sent: number };
    expect(out.sent).toBe(1);
    expect(await memberNotes(stay.member.id)).toHaveLength(1);
  });

  it("per-gym override: disabled rule sends nothing but the recovery task is still opened; channels and minDaysInactive are honoured", async () => {
    const off = await makeGym();
    await signInStaff(off.gym.id, "OWNER");
    await put({ op: "override", key: "inactive-member-nudge", enabled: false, delayMinutes: 0, channels: ["IN_APP"] });
    await put({ op: "override", key: "inactive-staff-alert", enabled: false, delayMinutes: 0, channels: ["IN_APP"] });
    const a = await memberWithLogin(off.gym.id, off.plan.id, { daysAgo: 20 });
    await run("risk.recalculate", { gymId: off.gym.id });
    expect(await prisma.notification.count({ where: { gymId: off.gym.id } })).toBe(0);
    expect(await prisma.recoveryTask.count({ where: { memberId: a.member.id } })).toBe(1);

    const on = await makeGym();
    await signInStaff(on.gym.id, "OWNER");
    await put({ op: "override", key: "inactive-member-nudge", enabled: true, delayMinutes: 0, minDaysInactive: 11, channels: ["IN_APP"] });
    const b = await memberWithLogin(on.gym.id, on.plan.id, { daysAgo: 12 });
    await run("risk.recalculate", { gymId: on.gym.id });
    const notes = await memberNotes(b.member.id);
    expect(notes.map((n) => n.channel)).toEqual(["IN_APP"]); // no SMS row at all: channel override respected
    // Another gym is unaffected by these overrides.
    const other = await makeGym();
    await signInStaff(other.gym.id, "OWNER");
    const c = await memberWithLogin(other.gym.id, other.plan.id, { daysAgo: 12 });
    await run("risk.recalculate", { gymId: other.gym.id });
    expect(await memberNotes(c.member.id)).toHaveLength(0); // platform minDaysInactive is 14
  });

  it("the automation feature flag off: no rule actions, but at-risk members still get a recovery task", async () => {
    const { gym, plan } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    await prisma.featureFlag.create({ data: { key: "automation", scope: "GYM", scopeId: gym.id, enabled: false } });
    const m = await memberWithLogin(gym.id, plan.id, { daysAgo: 20 });
    await run("risk.recalculate", { gymId: gym.id });
    expect(await prisma.notification.count({ where: { gymId: gym.id } })).toBe(0);
    expect(await prisma.recoveryTask.count({ where: { memberId: m.member.id } })).toBe(1);
  });
});

describe("/api/gym/automations", () => {
  it("lists platform rules with the gym's override, audits changes, and reset restores the platform rule", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    type Rule = { key: string; enabled: boolean; delayMinutes: number; overridden: boolean; channels: string[]; conditions: { minDaysInactive?: number } };
    const find = async () => (await json<Rule[]>(await getRules(req("/api/gym/automations")))).find((r) => r.key === "inactive-member-nudge")!;
    expect(await find()).toMatchObject({ enabled: true, delayMinutes: 0, overridden: false, channels: ["IN_APP", "SMS"], conditions: { minDaysInactive: 14 } });
    expect((await put({ op: "override", key: "inactive-member-nudge", enabled: false, delayMinutes: 45, minDaysInactive: 21, channels: ["IN_APP", "EMAIL"] })).status).toBe(200);
    expect(await find()).toMatchObject({ enabled: false, delayMinutes: 45, overridden: true, channels: ["IN_APP", "EMAIL"], conditions: { minDaysInactive: 21 } });
    expect(await prisma.auditLog.count({ where: { gymId: gym.id, action: "automations.gym_override" } })).toBe(1);
    // The platform rule is untouched.
    expect((await prisma.automationRule.findFirstOrThrow({ where: { gymId: null, key: "inactive-member-nudge" } })).delayMinutes).toBe(0);
    expect((await put({ op: "reset", key: "inactive-member-nudge" })).status).toBe(200);
    expect(await find()).toMatchObject({ enabled: true, delayMinutes: 0, overridden: false });
    expect(await prisma.automationRule.count({ where: { gymId: gym.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { gymId: gym.id, action: "automations.gym_reset" } })).toBe(1);
  });

  it("rejects bad input, WhatsApp on a plan without it, unknown keys, and non-managers", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    const base = { op: "override", key: "inactive-member-nudge", enabled: true, delayMinutes: 0, channels: ["IN_APP"] };
    expect((await put({ ...base, delayMinutes: -5 })).status).toBe(400);
    expect((await put({ ...base, delayMinutes: 60 * 24 * 15 })).status).toBe(400);
    expect((await put({ ...base, channels: [] })).status).toBe(400);
    expect((await put({ ...base, channels: ["WHATSAPP"] })).status).toBe(400); // whatsapp flag defaults off
    expect((await put({ ...base, key: "no-such-rule" })).status).toBe(400);
    expect(await prisma.automationRule.count({ where: { gymId: gym.id } })).toBe(0);
    for (const role of ["STAFF", "TRAINER"] as const) {
      await signInStaff(gym.id, role);
      expect((await put({ ...base, enabled: false })).status).toBe(403);
    }
    signOut();
    expect((await put({ ...base, enabled: false })).status).toBe(401);
    expect(await prisma.automationRule.count({ where: { gymId: gym.id } })).toBe(0);
  });
});

describe("renewal reminders (automation.renewals)", () => {
  async function renewalGym() {
    const { gym, plan } = await makeGym();
    const m = await memberWithLogin(gym.id, plan.id, { daysAgo: 1, endsIn: 7 });
    return { gym, plan, m };
  }
  const setEnd = (id: string, offset: number, status: "ACTIVE" | "EXPIRED" = "ACTIVE") => prisma.membership.update({ where: { id }, data: { endDate: toDbDate(day(offset)), startDate: toDbDate(day(offset - 30)), status } });
  const renewalNotes = (memberId: string) => prisma.notification.findMany({ where: { memberId, category: "RENEWAL" }, orderBy: { createdAt: "asc" } });

  it("reminds at 7, 3, 1 and 0 days before expiry - each offset once - and not on other days", async () => {
    const { gym, m } = await renewalGym();
    const inApp = async () => (await renewalNotes(m.member.id)).filter((n) => n.channel === "IN_APP");
    const seen: string[] = [];
    for (const offset of [7, 6, 5, 4, 3, 2, 1, 0]) {
      await setEnd(m.membership.id, offset);
      const before = (await inApp()).length;
      const res = (await run("automation.renewals", { gymId: gym.id })) as { sent: number };
      await run("automation.renewals", { gymId: gym.id }); // second hourly run the same day
      const after = await inApp();
      if ([7, 3, 1, 0].includes(offset)) {
        expect(after.length).toBe(before + 1);
        expect(res.sent).toBe(1);
        expect(after.at(-1)!.dedupeKey).toBe(`renewal:${m.membership.id}:${offset}:IN_APP`);
        seen.push(after.at(-1)!.body);
      } else {
        expect(after.length).toBe(before);
        expect(res.sent).toBe(0);
      }
    }
    expect((await inApp()).length).toBe(4);
    expect(seen[0]).toMatch(/7 days/);
    expect(seen[1]).toMatch(/3 days/);
    expect(seen[2]).toMatch(/tomorrow/);
    expect(seen[3]).toMatch(/today/);
    // The SMS leg has no provider: recorded as skipped for each offset, never queued.
    const sms = (await renewalNotes(m.member.id)).filter((n) => n.channel === "SMS");
    expect(sms).toHaveLength(4);
    expect(sms.every((n) => n.status === "SKIPPED" && /provider/i.test(n.error ?? ""))).toBe(true);
  });

  it("concurrent runs send each reminder once", async () => {
    const { gym, m } = await renewalGym();
    await Promise.all([1, 2, 3, 4].map(() => run("automation.renewals", { gymId: gym.id })));
    expect((await renewalNotes(m.member.id)).filter((n) => n.channel === "IN_APP")).toHaveLength(1);
  });

  it("uses the post-expiry template after expiry (-3 days) and skips renewed, archived and already-extended members", async () => {
    const { gym, plan, m } = await renewalGym();
    await setEnd(m.membership.id, -3, "EXPIRED");
    await run("automation.renewals", { gymId: gym.id });
    const notes = (await renewalNotes(m.member.id)).filter((n) => n.channel === "IN_APP");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.templateKey).toBe("MEMBERSHIP_EXPIRED");
    expect(notes[0]!.body).toContain(formatDate(day(-3)));

    const renewed = await memberWithLogin(gym.id, plan.id, { daysAgo: 1, endsIn: 3 });
    await prisma.membership.create({ data: { gymId: gym.id, memberId: renewed.member.id, planId: plan.id, startDate: toDbDate(day(4)), endDate: toDbDate(day(34)), pricePaisa: 150_000, status: "ACTIVE", isRenewal: true, renewedFromId: renewed.membership.id } });
    const archived = await memberWithLogin(gym.id, plan.id, { daysAgo: 1, endsIn: 3 });
    await prisma.member.update({ where: { id: archived.member.id }, data: { archivedAt: new Date() } });
    const control = await memberWithLogin(gym.id, plan.id, { daysAgo: 1, endsIn: 3 });
    await run("automation.renewals", { gymId: gym.id });
    expect(await renewalNotes(renewed.member.id)).toHaveLength(0);
    expect(await renewalNotes(archived.member.id)).toHaveLength(0);
    expect((await renewalNotes(control.member.id)).length).toBeGreaterThan(0);
  });

  it("a member without an app login gets a SKIPPED in-app row with a reason; other gyms' members are untouched", async () => {
    const { gym, plan } = await makeGym();
    const noLogin = await seedMember(gym.id, plan.id, { daysAgo: 1, endsIn: 1 });
    const foreign = await makeGym();
    const alien = await seedMember(foreign.gym.id, foreign.plan.id, { daysAgo: 1, endsIn: 1 });
    await run("automation.renewals", { gymId: gym.id });
    const notes = await renewalNotes(noLogin.member.id);
    expect(notes.find((n) => n.channel === "IN_APP")).toMatchObject({ status: "SKIPPED", error: expect.stringMatching(/activated/) });
    expect(await renewalNotes(alien.member.id)).toHaveLength(0);
  });

  it("is switched off by the automation flag and by disabling both renewal rules for the gym", async () => {
    const a = await renewalGym();
    await prisma.featureFlag.create({ data: { key: "automation", scope: "GYM", scopeId: a.gym.id, enabled: false } });
    expect(await run("automation.renewals", { gymId: a.gym.id })).toMatchObject({ sent: 0 });
    expect(await renewalNotes(a.m.member.id)).toHaveLength(0);

    const b = await renewalGym();
    await signInStaff(b.gym.id, "OWNER");
    for (const key of ["renewal-sequence", "expired-followup"]) await put({ op: "override", key, enabled: false, delayMinutes: 0, channels: ["IN_APP"] });
    expect(await run("automation.renewals", { gymId: b.gym.id })).toMatchObject({ sent: 0 });
    expect(await renewalNotes(b.m.member.id)).toHaveLength(0);
  });

  it("a gym's renewal channel override replaces the default channels", async () => {
    const { gym, m } = await renewalGym();
    await signInStaff(gym.id, "OWNER");
    await put({ op: "override", key: "renewal-sequence", enabled: true, delayMinutes: 0, channels: ["IN_APP"] });
    await run("automation.renewals", { gymId: gym.id });
    expect((await renewalNotes(m.member.id)).map((n) => n.channel)).toEqual(["IN_APP"]);
  });
});
