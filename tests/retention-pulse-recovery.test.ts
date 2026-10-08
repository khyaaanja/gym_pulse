import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { errCode, json, params, req, signInMember, signInStaff, signOut } from "./helpers/route";
import { day, seedMember } from "./helpers/retention";
import { makeGym } from "./helpers/fixtures";
import { recalculateGymRisk } from "@/services/risk/run";
import { checkIn } from "@/services/attendance";
import { onMemberRenewed } from "@/services/recovery";
import { today as todayIn } from "@/lib/time";

const { GET: pulse } = await import("@/app/api/gym/pulse/route");
const { GET: listTasks, POST: startTask } = await import("@/app/api/gym/recovery/route");
const { GET: getTask, POST: act } = await import("@/app/api/gym/recovery/[id]/route");
const { GET: report } = await import("@/app/api/gym/reports/[key]/route");

beforeEach(() => signOut());

type Card = { id: string; riskStatus: string; daysInactive: number | null; monthlyFeePaisa: number; visitsLast30: number; task: { id: string } | null };
const pulseItems = async (filter = "AT_RISK") => {
  const res = await pulse(req(`/api/gym/pulse?filter=${filter}`));
  expect(res.status).toBe(200);
  return (await json<{ items: Card[]; total: number }>(res)).items;
};

describe("pulse at-risk list", () => {
  it("flags only members past the inactivity threshold, with revenue-at-stake maths", async () => {
    const { gym, plan } = await makeGym();
    const quiet = await seedMember(gym.id, plan.id, { daysAgo: 12, pricePaisa: 300_000 }); // 30-day plan => 300000/month
    const edge = await seedMember(gym.id, plan.id, { daysAgo: 10 });
    const fine = await seedMember(gym.id, plan.id, { daysAgo: 2 });
    const justUnder = await seedMember(gym.id, plan.id, { daysAgo: 9 });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    const items = await pulseItems("AT_RISK");
    const ids = items.map((i) => i.id);
    expect(ids).toContain(quiet.member.id);
    expect(ids).toContain(edge.member.id); // threshold is >= 10 days
    expect(ids).not.toContain(fine.member.id);
    expect(ids).not.toContain(justUnder.member.id);
    const q = items.find((i) => i.id === quiet.member.id)!;
    expect(q.daysInactive).toBe(12);
    expect(q.monthlyFeePaisa).toBe(300_000);
    // Ordered by risk score: the longer-inactive member comes first.
    expect(ids.indexOf(quiet.member.id)).toBeLessThan(ids.indexOf(edge.member.id));
    const attention = (await pulseItems("ATTENTION")).map((i) => i.id);
    expect(attention).toContain(justUnder.member.id);
  });

  it("converts a long plan to a monthly figure (90-day, 450000 -> 150000/month)", async () => {
    const { gym } = await makeGym();
    const quarterly = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Quarterly", durationDays: 90, pricePaisa: 450_000, active: true } });
    const m = await seedMember(gym.id, quarterly.id, { daysAgo: 15, pricePaisa: 450_000 });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    expect((await pulseItems()).find((i) => i.id === m.member.id)?.monthlyFeePaisa).toBe(150_000);
  });

  it("honours a per-gym inactivity threshold", async () => {
    const { gym, plan } = await makeGym();
    await prisma.predictionConfig.create({ data: { gymId: gym.id, inactivityThresholdDays: 5, attentionAfterDays: 3 } });
    const m = await seedMember(gym.id, plan.id, { daysAgo: 6 });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    expect((await pulseItems()).map((i) => i.id)).toContain(m.member.id);
    // Same member under the default threshold (10 days) is not at risk.
    const other = await makeGym();
    const o = await seedMember(other.gym.id, other.plan.id, { daysAgo: 6 });
    await recalculateGymRisk(other.gym.id);
    await signInStaff(other.gym.id, "OWNER");
    expect((await pulseItems()).map((i) => i.id)).not.toContain(o.member.id);
  });

  it("an expired-and-lapsed member is LOST, not AT_RISK", async () => {
    const { gym, plan } = await makeGym();
    const lost = await seedMember(gym.id, plan.id, { daysAgo: 40, endsIn: -30 });
    await prisma.membership.update({ where: { id: lost.membership.id }, data: { status: "EXPIRED" } });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    expect((await pulseItems("AT_RISK")).map((i) => i.id)).not.toContain(lost.member.id);
    expect((await pulseItems("LOST")).map((i) => i.id)).toContain(lost.member.id);
  });

  it("a trainer sees only their assigned members; owner sees all; other gyms never leak", async () => {
    const { gym, plan } = await makeGym();
    const { staff: trainer } = await signInStaff(gym.id, "TRAINER");
    const mine = await seedMember(gym.id, plan.id, { daysAgo: 14, trainerId: trainer.id });
    const theirs = await seedMember(gym.id, plan.id, { daysAgo: 14 });
    const foreign = await makeGym();
    const alien = await seedMember(foreign.gym.id, foreign.plan.id, { daysAgo: 14 });
    await recalculateGymRisk(gym.id);
    await recalculateGymRisk(foreign.gym.id);
    const tIds = (await pulseItems()).map((i) => i.id);
    expect(tIds).toEqual([mine.member.id]);
    await signInStaff(gym.id, "OWNER");
    const oIds = (await pulseItems()).map((i) => i.id);
    expect(oIds).toEqual(expect.arrayContaining([mine.member.id, theirs.member.id]));
    expect(oIds).not.toContain(alien.member.id);
  });

  it("is refused to a member login and to signed-out callers", async () => {
    const { gym, plan } = await makeGym();
    const m = await seedMember(gym.id, plan.id, { daysAgo: 14 });
    expect((await pulse(req("/api/gym/pulse"))).status).toBe(401);
    await signInMember(gym.id, m.member.id);
    expect([401, 403]).toContain((await pulse(req("/api/gym/pulse"))).status);
  });
});

describe("recovery workflow", () => {
  async function atRisk() {
    const { gym, plan } = await makeGym();
    const m = await seedMember(gym.id, plan.id, { daysAgo: 15, pricePaisa: 200_000 });
    await recalculateGymRisk(gym.id);
    const s = await signInStaff(gym.id, "OWNER");
    return { gym, plan, m, s };
  }
  const start = (memberId: string, reason?: string) => startTask(req("/api/gym/recovery", { body: { memberId, reason } }));
  const post = (id: string, body: unknown) => act(req(`/api/gym/recovery/${id}`, { body }), params({ id }));

  it("starting recovery creates one task with fee, CREATED event and an audit row; repeat is idempotent (also concurrently)", async () => {
    const { gym, m } = await atRisk();
    const results = await Promise.all([start(m.member.id), start(m.member.id), start(m.member.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const bodies = await Promise.all(results.map((r) => json<{ created: boolean }>(r)));
    expect(bodies.filter((b) => b.created)).toHaveLength(1);
    const tasks = await prisma.recoveryTask.findMany({ where: { memberId: m.member.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.monthlyFeePaisa).toBe(200_000);
    expect(tasks[0]!.status).toBe("NOT_CONTACTED");
    expect(await prisma.recoveryEvent.count({ where: { taskId: tasks[0]!.id, type: "CREATED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { gymId: gym.id, action: "recovery.started", entityId: tasks[0]!.id } })).toBe(1);
  });

  it("logs contacts: CALL/WHATSAPP/SMS map to the right status, events and timestamps", async () => {
    const { m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    expect((await post(task.id, { action: "contact", method: "CALL", result: "Will come Monday" })).status).toBe(200);
    let row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("CONTACTED");
    expect(row.contactMethod).toBe("CALL");
    expect(row.contactResult).toBe("Will come Monday");
    expect(row.lastContactAt).not.toBeNull();
    expect((await post(task.id, { action: "contact", method: "WHATSAPP" })).status).toBe(200);
    const fu = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await post(task.id, { action: "contact", method: "SMS", followUpAt: fu })).status).toBe(200);
    row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("FOLLOW_UP");
    expect(row.followUpAt?.toISOString()).toBe(fu);
    const types = (await prisma.recoveryEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(types).toEqual(["CREATED", "CALLED", "WHATSAPP_OPENED", "MARKED_CONTACTED", "FOLLOW_UP_SET"]);
    const detail = await json<{ events: unknown[] }>(await getTask(req(`/api/gym/recovery/${task.id}`), params({ id: task.id })));
    expect(detail.events).toHaveLength(5);
    expect(await errCode(await post(task.id, { action: "contact", method: "CARRIER_PIGEON" }))).toBeTruthy();
  });

  it("MESSAGE with no provider records MESSAGE_NOT_SENT and does not count as a contact", async () => {
    const { m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    const res = await post(task.id, { action: "message", channel: "SMS", body: "We miss you at the gym!" });
    expect(res.status).toBe(200);
    const n = await json<{ status: string; error: string }>(res);
    expect(n.status).toBe("SKIPPED");
    expect(n.error).toMatch(/provider/i);
    const ev = await prisma.recoveryEvent.findFirstOrThrow({ where: { taskId: task.id, type: { in: ["MESSAGE_SENT", "MESSAGE_NOT_SENT"] } } });
    expect(ev.type).toBe("MESSAGE_NOT_SENT");
    expect(ev.note).toMatch(/Not delivered/);
    const row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("NOT_CONTACTED");
    expect(row.lastContactAt).toBeNull();
  });

  it("an in-app message to a member with a login is SENT and moves the task to CONTACTED", async () => {
    const { gym, plan } = await makeGym();
    const user = await prisma.user.create({ data: { name: "Linked", email: `linked-${Math.random()}@example.test` } });
    const m = await seedMember(gym.id, plan.id, { daysAgo: 15, userId: user.id });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    const n = await json<{ status: string }>(await post(task.id, { action: "message", channel: "IN_APP", body: "Come back soon" }));
    expect(n.status).toBe("SENT");
    expect(await prisma.notification.count({ where: { userId: user.id, channel: "IN_APP" } })).toBe(1);
    expect((await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("CONTACTED");
    expect(await prisma.recoveryEvent.count({ where: { taskId: task.id, type: "MESSAGE_SENT" } })).toBe(1);
  });

  it("staff without notifications.send cannot message; a trainer cannot use recovery at all", async () => {
    const { gym, plan } = await makeGym();
    const m = await seedMember(gym.id, plan.id, { daysAgo: 15 });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "STAFF");
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    await signInStaff(gym.id, "STAFF", { revokedPermissions: ["notifications.send"] });
    const denied = await post(task.id, { action: "message", channel: "IN_APP", body: "Hello there" });
    expect(denied.status).toBe(403);
    expect(await prisma.notification.count({ where: { memberId: m.member.id } })).toBe(0);
    await signInStaff(gym.id, "TRAINER");
    expect((await start(m.member.id)).status).toBe(403);
    expect((await post(task.id, { action: "lost" })).status).toBe(403);
    expect((await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } })).closedAt).toBeNull();
  });

  it("outcome LOST closes the task; a closed task refuses further actions; a new task can then be opened", async () => {
    const { m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    expect((await post(task.id, { action: "lost", note: "moved city" })).status).toBe(200);
    const row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("LOST");
    expect(row.closedAt).not.toBeNull();
    expect(await prisma.recoveryEvent.count({ where: { taskId: task.id, type: "MARKED_LOST", note: "moved city" } })).toBe(1);
    expect((await post(task.id, { action: "contact", method: "CALL" })).status).toBe(400);
    expect((await post(task.id, { action: "lost" })).status).toBe(400);
    const again = await json<{ created: boolean; task: { id: string } }>(await start(m.member.id));
    expect(again.created).toBe(true);
    expect(again.task.id).not.toBe(task.id);
  });

  it("outcome RETURNED (manual) keeps the task open as RETURNED with a returnedAt; notes are recorded", async () => {
    const { m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    expect((await post(task.id, { action: "returned" })).status).toBe(200);
    const row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("RETURNED");
    expect(row.returnedAt).not.toBeNull();
    expect(row.closedAt).toBeNull();
    expect((await post(task.id, { action: "note", note: "  spoke to his wife " })).status).toBe(200);
    expect(await prisma.recoveryEvent.count({ where: { taskId: task.id, type: "NOTE" } })).toBe(1);
    expect((await post(task.id, { action: "note", note: "   " })).status).toBe(400);
  });

  it("task auto-resolves to RETURNED when the member checks in again", async () => {
    const { gym, m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    expect((await prisma.member.findUniqueOrThrow({ where: { id: m.member.id } })).riskStatus).toBe("AT_RISK");
    const res = await checkIn(gym, m.member.id, "STAFF");
    expect(res.status).toBe("accepted");
    const row = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("RETURNED");
    expect(row.returnedAt).not.toBeNull();
    expect(await prisma.recoveryEvent.count({ where: { taskId: task.id, type: "MEMBER_RETURNED" } })).toBe(1);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: m.member.id } })).riskStatus).toBe("ACTIVE");
  });

  it("RENEWED: credits protected revenue only when staff contacted the member first", async () => {
    const { gym, plan } = await makeGym();
    const contacted = await seedMember(gym.id, plan.id, { daysAgo: 15, pricePaisa: 200_000 });
    const untouched = await seedMember(gym.id, plan.id, { daysAgo: 15, pricePaisa: 200_000 });
    await recalculateGymRisk(gym.id);
    await signInStaff(gym.id, "OWNER");
    const t1 = (await json<{ task: { id: string } }>(await start(contacted.member.id))).task.id;
    const t2 = (await json<{ task: { id: string } }>(await start(untouched.member.id))).task.id;
    await post(t1, { action: "contact", method: "CALL" });
    await onMemberRenewed(gym.id, contacted.member.id, new Date(Date.now() + 1000));
    await onMemberRenewed(gym.id, untouched.member.id, new Date(Date.now() + 1000));
    const a = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: t1 } });
    const b = await prisma.recoveryTask.findUniqueOrThrow({ where: { id: t2 } });
    expect([a.status, b.status]).toEqual(["RENEWED", "RENEWED"]);
    expect(a.closedAt).not.toBeNull();
    expect(a.protectedRevenuePaisa).toBe(200_000 * 6); // 6 protected months by default
    expect(b.protectedRevenuePaisa).toBeNull();
    expect((await prisma.recoveryEvent.findFirstOrThrow({ where: { taskId: t2, type: "RENEWED" } })).note).toMatch(/not credited/);
  });

  it("lists open vs closed tasks scoped to the gym, and the recovery report CSV carries the rows", async () => {
    const { gym, plan } = await makeGym();
    const a = await seedMember(gym.id, plan.id, { daysAgo: 15, name: "Open Olivia" });
    const b = await seedMember(gym.id, plan.id, { daysAgo: 15, name: "Lost Larry" });
    const other = await makeGym();
    const c = await seedMember(other.gym.id, other.plan.id, { daysAgo: 15, name: "Foreign Fiona" });
    await recalculateGymRisk(gym.id);
    await signInStaff(other.gym.id, "OWNER");
    await start(c.member.id);
    await signInStaff(gym.id, "OWNER");
    await start(a.member.id);
    const tb = (await json<{ task: { id: string } }>(await start(b.member.id))).task.id;
    await post(tb, { action: "contact", method: "CALL", result: "no answer" });
    await post(tb, { action: "lost" });
    const open = await json<{ items: { member: { fullName: string } }[] }>(await listTasks(req("/api/gym/recovery?status=OPEN")));
    expect(open.items.map((i) => i.member.fullName)).toEqual(["Open Olivia"]);
    const closed = await json<{ items: { member: { fullName: string } }[] }>(await listTasks(req("/api/gym/recovery?status=CLOSED")));
    expect(closed.items.map((i) => i.member.fullName)).toEqual(["Lost Larry"]);
    const res = await report(req("/api/gym/reports/recovery?range=30d"), params({ key: "recovery" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const csv = await res.text();
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Status");
    expect(lines).toHaveLength(3); // header + 2 tasks of this gym
    expect(csv).toContain("Open Olivia");
    const larry = lines.find((l) => l.includes("Lost Larry"))!;
    expect(larry).toContain("LOST");
    expect(larry).toContain("no answer");
    expect(csv).not.toContain("Foreign Fiona");
    expect(await prisma.auditLog.count({ where: { gymId: gym.id, action: "reports.exported", entityId: "recovery" } })).toBe(1);
  });

  it("cannot act on another gym's task", async () => {
    const { m } = await atRisk();
    const { task } = await json<{ task: { id: string } }>(await start(m.member.id));
    const other = await makeGym();
    await signInStaff(other.gym.id, "OWNER");
    expect((await post(task.id, { action: "lost" })).status).toBe(404);
    expect((await getTask(req(`/api/gym/recovery/${task.id}`), params({ id: task.id }))).status).toBe(404);
    expect((await prisma.recoveryTask.findUniqueOrThrow({ where: { id: task.id } })).closedAt).toBeNull();
    void todayIn; void day;
  });
});
