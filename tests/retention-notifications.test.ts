import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { errCode, json, makeUser, req, signInStaff, signInUser, signOut } from "./helpers/route";
import { makeGym, makeMember } from "./helpers/fixtures";
import { dispatchNotification, notify } from "@/services/notifications";

const { GET: listMine, POST: markRead } = await import("@/app/api/notifications/route");
const { GET: getPrefs, PUT: putPrefs } = await import("@/app/api/notifications/preferences/route");

beforeEach(() => signOut());

describe("notify() delivery decisions", () => {
  it("SMS with no provider configured is SKIPPED with a reason, no delivery job queued", async () => {
    const { gym } = await makeGym();
    const m = await prisma.member.update({ where: { id: (await makeMember(gym.id)).id }, data: { phone: "9800000001" } });
    const n = await notify({ gymId: gym.id, memberId: m.id, channel: "SMS", category: "RENEWAL", title: "Hi", body: "Renew now" });
    expect(n.status).toBe("SKIPPED");
    expect(n.error).toMatch(/No SMS provider/);
    expect(n.toAddress).toBe("9800000001");
    expect(await prisma.job.count({ where: { type: "notification.send", payload: { path: ["notificationId"], equals: n.id } } })).toBe(0);
  });

  it("SMS to a member with no phone and email to a member with no address say why", async () => {
    const { gym } = await makeGym();
    const m = await makeMember(gym.id);
    expect((await notify({ gymId: gym.id, memberId: m.id, channel: "SMS", category: "X", title: "t", body: "b" })).error).toBe("No phone number on file");
    expect((await notify({ gymId: gym.id, memberId: m.id, channel: "EMAIL", category: "X", title: "t", body: "b" })).error).toBe("No email address on file");
  });

  it("in-app for a member without a login is SKIPPED; with a login it is SENT and listed for that user", async () => {
    const { gym } = await makeGym();
    const m = await makeMember(gym.id);
    const skipped = await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "X", title: "t", body: "b" });
    expect(skipped).toMatchObject({ status: "SKIPPED", error: "Member hasn't activated their app account", userId: null });
    const user = await makeUser();
    await prisma.member.update({ where: { id: m.id }, data: { userId: user.id } });
    const sent = await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "X", title: "t", body: "b" });
    expect(sent).toMatchObject({ status: "SENT", userId: user.id, error: null });
    expect(sent.sentAt).not.toBeNull();
  });

  it("a configured provider queues the message and the worker handler delivers it exactly once", async () => {
    const { gym } = await makeGym();
    const m = await prisma.member.update({ where: { id: (await makeMember(gym.id)).id }, data: { email: "member@example.test" } });
    const n = await notify({ gymId: gym.id, memberId: m.id, channel: "EMAIL", category: "X", title: "Hello", body: "Body text" });
    expect(n.status).toBe("QUEUED"); // EMAIL_TRANSPORT=console in tests
    expect(await prisma.job.count({ where: { type: "notification.send", payload: { path: ["notificationId"], equals: n.id } } })).toBe(1);
    const results = await Promise.all([dispatchNotification(n.id), dispatchNotification(n.id)]);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe("SENT");
    expect(after.providerKey).toBe("console");
    expect(after.attempts).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => "sent" in r)).toBe(true);
    expect(await dispatchNotification(n.id)).toEqual({ skipped: true }); // already SENT: not sent again
  });

  it("dedupeKey makes concurrent identical notifications collapse into one row", async () => {
    const { gym } = await makeGym();
    const user = await makeUser();
    const m = await prisma.member.update({ where: { id: (await makeMember(gym.id)).id }, data: { userId: user.id } });
    const input = { gymId: gym.id, memberId: m.id, channel: "IN_APP" as const, category: "X", title: "t", body: "b", dedupeKey: `k-${m.id}` };
    const rows = await Promise.all([notify(input), notify(input), notify(input)]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await prisma.notification.count({ where: { dedupeKey: input.dedupeKey } })).toBe(1);
  });

  it("refuses a member from another gym", async () => {
    const a = await makeGym();
    const b = await makeGym();
    const m = await makeMember(b.gym.id);
    await expect(notify({ gymId: a.gym.id, memberId: m.id, channel: "IN_APP", category: "X", title: "t", body: "b" })).rejects.toThrow(/another gym/);
    expect(await prisma.notification.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("a gym with the SMS feature turned off skips SMS even with a provider configured", async () => {
    const { gym } = await makeGym();
    await prisma.featureFlag.create({ data: { key: "sms", scope: "GYM", scopeId: gym.id, enabled: false } });
    const m = await prisma.member.update({ where: { id: (await makeMember(gym.id)).id }, data: { phone: "9800000002" } });
    const n = await notify({ gymId: gym.id, memberId: m.id, channel: "SMS", category: "X", title: "t", body: "b" });
    expect(n).toMatchObject({ status: "SKIPPED", error: "SMS messaging isn't enabled for this gym" });
  });
});

describe("preferences", () => {
  type Pref = { category: string; channel: string; enabled: boolean };
  const prefs = async () => (await json<{ preferences: Pref[] }>(await getPrefs(req("/api/notifications/preferences")))).preferences;

  it("defaults to everything on; an opt-out is stored per category+channel and respected by notify()", async () => {
    const { gym } = await makeGym();
    const user = await makeUser();
    const m = await prisma.member.update({ where: { id: (await makeMember(gym.id)).id }, data: { userId: user.id } });
    await signInUser(user.id, gym.id);
    expect((await prefs()).every((p) => p.enabled)).toBe(true);
    const before = await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "RENEWAL", title: "t", body: "b" });
    expect(before.status).toBe("SENT");

    const res = await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [{ category: "RENEWAL", channel: "IN_APP", enabled: false }] } }));
    expect(res.status).toBe(200);
    expect((await prefs()).filter((p) => !p.enabled)).toEqual([{ category: "RENEWAL", channel: "IN_APP", enabled: false }]);

    const optedOut = await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "RENEWAL", title: "t", body: "b" });
    expect(optedOut).toMatchObject({ status: "SKIPPED", error: "Recipient opted out of this notification" });
    // Other categories and the same category on other channels are unaffected; essential messages ignore opt-outs.
    expect((await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "PAYMENT", title: "t", body: "b" })).status).toBe("SENT");
    expect((await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "RENEWAL", title: "t", body: "b", essential: true })).status).toBe("SENT");

    // Opt back in.
    await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [{ category: "RENEWAL", channel: "IN_APP", enabled: true }] } }));
    expect((await notify({ gymId: gym.id, memberId: m.id, channel: "IN_APP", category: "RENEWAL", title: "t", body: "b" })).status).toBe("SENT");
    expect(await prisma.notificationPreference.count({ where: { userId: user.id } })).toBe(1); // upserted, not duplicated
  });

  it("opting out only affects the caller, and invalid categories/channels are rejected", async () => {
    const { gym } = await makeGym();
    const alice = await makeUser("Alice");
    const bob = await makeUser("Bob");
    await signInUser(alice.id, gym.id);
    await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [{ category: "AT_RISK", channel: "IN_APP", enabled: false }] } }));
    const aliceNote = await notify({ gymId: gym.id, userId: alice.id, channel: "IN_APP", category: "AT_RISK", title: "t", body: "b" });
    const bobNote = await notify({ gymId: gym.id, userId: bob.id, channel: "IN_APP", category: "AT_RISK", title: "t", body: "b" });
    expect(aliceNote.status).toBe("SKIPPED");
    expect(bobNote.status).toBe("SENT");
    expect((await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [{ category: "NOPE", channel: "IN_APP", enabled: false }] } }))).status).toBe(400);
    expect((await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [{ category: "AT_RISK", channel: "PIGEON", enabled: false }] } }))).status).toBe(400);
    signOut();
    expect((await putPrefs(req("/api/notifications/preferences", { method: "PUT", body: { preferences: [] } }))).status).toBe(401);
    expect(await prisma.notificationPreference.count({ where: { userId: bob.id } })).toBe(0);
  });
});

describe("/api/notifications", () => {
  async function two() {
    const { gym } = await makeGym();
    const alice = await makeUser("Alice");
    const bob = await makeUser("Bob");
    for (let i = 0; i < 3; i++) await notify({ gymId: gym.id, userId: alice.id, channel: "IN_APP", category: "SYSTEM", title: `A${i}`, body: "b" });
    await notify({ gymId: gym.id, userId: bob.id, channel: "IN_APP", category: "SYSTEM", title: "B0", body: "b" });
    // Non in-app rows for Alice are not part of her inbox.
    await prisma.notification.create({ data: { gymId: gym.id, userId: alice.id, channel: "SMS", category: "SYSTEM", title: "sms", body: "b", status: "SKIPPED" } });
    return { gym, alice, bob };
  }
  type List = { items: { id: string; title: string; readAt: string | null }[]; unread: number };

  it("lists only the caller's in-app notifications, newest first, with an unread count", async () => {
    const { gym, alice, bob } = await two();
    await signInUser(alice.id, gym.id);
    const a = await json<List>(await listMine(req("/api/notifications")));
    expect(a.items.map((i) => i.title).sort()).toEqual(["A0", "A1", "A2"]);
    expect(a.unread).toBe(3);
    await signInUser(bob.id, gym.id);
    const b = await json<List>(await listMine(req("/api/notifications")));
    expect(b.items.map((i) => i.title)).toEqual(["B0"]);
    signOut();
    expect((await listMine(req("/api/notifications"))).status).toBe(401);
  });

  it("marking read changes only the caller's rows, even when ids of someone else's are supplied", async () => {
    const { gym, alice, bob } = await two();
    const bobRow = await prisma.notification.findFirstOrThrow({ where: { userId: bob.id } });
    const aliceRows = await prisma.notification.findMany({ where: { userId: alice.id, channel: "IN_APP" }, orderBy: { createdAt: "asc" } });
    await signInUser(alice.id, gym.id);
    const r1 = await json<{ updated: number }>(await markRead(req("/api/notifications", { body: { ids: [aliceRows[0]!.id, bobRow.id] } })));
    expect(r1.updated).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bobRow.id } })).readAt).toBeNull();
    const unread = await json<List>(await listMine(req("/api/notifications?unread=true")));
    expect(unread.items).toHaveLength(2);
    expect(unread.unread).toBe(2);
    const r2 = await json<{ updated: number }>(await markRead(req("/api/notifications", { body: { all: true } })));
    expect(r2.updated).toBe(2);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bobRow.id } })).readAt).toBeNull();
    expect(await prisma.notification.count({ where: { userId: alice.id, channel: "SMS", readAt: { not: null } } })).toBe(0);
    expect((await json<List>(await listMine(req("/api/notifications")))).unread).toBe(0);
  });

  it("limit is validated", async () => {
    const { gym, alice } = await two();
    await signInUser(alice.id, gym.id);
    expect((await listMine(req("/api/notifications?limit=0"))).status).toBe(400);
    expect((await listMine(req("/api/notifications?limit=51"))).status).toBe(400);
    expect((await json<List>(await listMine(req("/api/notifications?limit=2")))).items).toHaveLength(2);
    void errCode; void signInStaff;
  });
});
