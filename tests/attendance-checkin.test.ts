import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { sha256 } from "@/lib/crypto";
import { addDays, localDate, toDbDate } from "@/lib/time";
import { kioskToken, memberPassToken } from "@/services/attendance";
import { errCode, json, params, req, signInMember, signInStaff, signOut } from "./helpers/route";
import { makeGym, makeMember } from "./helpers/fixtures";
import { giveMembership, gymWithMember, makeDevice } from "./helpers/attendance";

vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);

const { POST: deskCheckin } = await import("@/app/api/gym/checkin/route");
const { POST: selfCheckin } = await import("@/app/api/me/checkin/route");
const { GET: kiosk } = await import("@/app/api/gym/kiosk-token/route");
const { GET: pass } = await import("@/app/api/me/pass/route");
const { POST: deviceCheckin } = await import("@/app/api/devices/checkin/route");
const { GET: listLocations, POST: addLocation } = await import("@/app/api/gym/locations/route");
const { PATCH: patchLocation } = await import("@/app/api/gym/locations/[id]/route");

beforeEach(() => signOut());

type Res = { status: string; streak?: number; message?: string; warning?: string; memberName?: string };
const desk = (body: unknown) => deskCheckin(req("/api/gym/checkin", { body }));
const rows = (memberId: string) => prisma.attendance.count({ where: { memberId } });
const log = (memberId: string, outcome: "ACCEPTED" | "DUPLICATE" | "REJECTED") => prisma.checkIn.count({ where: { memberId, outcome } });
const enableMulti = (gymId: string) => prisma.featureFlag.create({ data: { key: "multi_location", scope: "GYM", scopeId: gymId, enabled: true } });

describe("desk check-in (/api/gym/checkin)", () => {
  it("rejects anonymous callers and writes nothing", async () => {
    const { member } = await gymWithMember();
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(401);
    expect(await rows(member.id)).toBe(0);
  });

  it("checks a member in once: attendance row, streak 1, totalVisits 1, ACCEPTED log", async () => {
    const { gym, member } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(200);
    const body = await json<Res>(res);
    expect(body.status).toBe("accepted");
    expect(body.streak).toBe(1);
    expect(body.memberName).toBe(member.fullName);
    const a = await prisma.attendance.findMany({ where: { memberId: member.id } });
    expect(a).toHaveLength(1);
    expect(a[0]!.method).toBe("STAFF");
    expect(a[0]!.recordedById).toBeTruthy();
    expect(a[0]!.localDate.toISOString().slice(0, 10)).toBe(localDate(new Date(), gym.timezone));
    const m = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect([m.totalVisits, m.currentStreak, m.bestStreak]).toEqual([1, 1, 1]);
    expect(m.lastAttendanceAt).not.toBeNull();
    expect(await log(member.id, "ACCEPTED")).toBe(1);
  });

  it("a second check-in the same local day is a duplicate: still one row, totals unchanged, DUPLICATE logged", async () => {
    const { gym, member } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    await desk({ memberId: member.id });
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(200);
    expect((await json<Res>(res)).status).toBe("duplicate");
    expect(await rows(member.id)).toBe(1);
    const m = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(m.totalVisits).toBe(1);
    expect(await log(member.id, "ACCEPTED")).toBe(1);
    expect(await log(member.id, "DUPLICATE")).toBe(1);
  });

  it("concurrent double check-in (Promise.all x4) produces exactly one Attendance row and one visit", async () => {
    const { gym, member } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    const results = await Promise.all([1, 2, 3, 4].map(() => desk({ memberId: member.id })));
    const bodies = await Promise.all(results.map((r) => json<Res>(r)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(bodies.filter((b) => b.status === "accepted")).toHaveLength(1);
    expect(bodies.filter((b) => b.status === "duplicate")).toHaveLength(3);
    expect(await rows(member.id)).toBe(1);
    const m = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(m.totalVisits).toBe(1);
    expect(m.currentStreak).toBe(1);
  });

  it("finds members by member code and by card uid", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "CARD-777" } });
    await signInStaff(gym.id, "STAFF");
    expect((await json<Res>(await desk({ memberCode: member.memberCode }))).status).toBe("accepted");
    expect((await json<Res>(await desk({ memberCode: "CARD-777" }))).status).toBe("duplicate");
    expect(await rows(member.id)).toBe(1);
    expect((await desk({ memberCode: "NOPE-0" })).status).toBe(404);
  });

  it("validates the body: empty / unknown shape is rejected and writes nothing", async () => {
    const { gym, member } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    expect((await desk({})).status).toBe(400);
    expect((await desk({ passToken: "short" })).status).toBe(400);
    expect(await rows(member.id)).toBe(0);
  });

  it("cannot check in another gym's member (404), by id, code or pass", async () => {
    const mine = await gymWithMember();
    const theirs = await gymWithMember();
    await signInStaff(mine.gym.id, "OWNER");
    expect((await desk({ memberId: theirs.member.id })).status).toBe(404);
    expect((await desk({ memberCode: theirs.member.memberCode })).status).toBe(404);
    // a pass minted for the other gym fails the gym check
    expect((await desk({ passToken: memberPassToken(theirs.member) })).status).toBe(400);
    expect(await rows(theirs.member.id)).toBe(0);
  });

  it("a trainer can only check in their own assigned members", async () => {
    const { gym, member } = await gymWithMember();
    const other = await prisma.member.create({ data: { gymId: gym.id, memberCode: `T-${member.memberCode}-b`, fullName: "Other", joinedOn: new Date() } });
    await giveMembership(gym.id, other.id, (await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } })).id, "2020-01-01", "2040-01-01");
    const { staff } = await signInStaff(gym.id, "TRAINER");
    await prisma.member.update({ where: { id: member.id }, data: { trainerId: staff.id } });
    expect((await desk({ memberId: other.id })).status).toBe(404);
    expect(await rows(other.id)).toBe(0);
    expect((await desk({ memberId: member.id })).status).toBe(200);
    expect(await rows(member.id)).toBe(1);
  });

  it("is refused when the attendance feature is switched off for the gym", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.featureFlag.create({ data: { key: "attendance", scope: "GYM", scopeId: gym.id, enabled: false } });
    await signInStaff(gym.id, "OWNER");
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("feature_disabled");
    expect(await rows(member.id)).toBe(0);
  });
});

describe("membership state at check-in", () => {
  it("suspended member -> 403 and no attendance", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });
    await signInStaff(gym.id, "OWNER");
    expect((await desk({ memberId: member.id })).status).toBe(403);
    expect(await rows(member.id)).toBe(0);
  });

  it("archived member -> 404", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { archivedAt: new Date() } });
    await signInStaff(gym.id, "OWNER");
    expect((await desk({ memberId: member.id })).status).toBe(404);
    expect(await rows(member.id)).toBe(0);
  });

  it("member with no membership at all -> 400, REJECTED logged, no attendance", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    await signInStaff(gym.id, "OWNER");
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(400);
    expect(await rows(member.id)).toBe(0);
    expect(await log(member.id, "REJECTED")).toBe(1);
    expect(await log(member.id, "ACCEPTED")).toBe(0);
  });

  it("membership expired beyond the grace period (5 days) -> 400, REJECTED, no attendance", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const today = localDate(new Date(), gym.timezone);
    await giveMembership(gym.id, member.id, plan.id, addDays(today, -60), addDays(today, -6));
    await signInStaff(gym.id, "OWNER");
    const res = await desk({ memberId: member.id });
    expect(res.status).toBe(400);
    expect(await rows(member.id)).toBe(0);
    expect(await log(member.id, "REJECTED")).toBe(1);
  });

  it("membership expired within the grace period -> accepted with a warning, and an at-risk member is NOT reset to ACTIVE", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await prisma.member.update({ where: { id: member.id }, data: { riskStatus: "AT_RISK" } });
    const today = localDate(new Date(), gym.timezone);
    await giveMembership(gym.id, member.id, plan.id, addDays(today, -60), addDays(today, -5));
    await signInStaff(gym.id, "OWNER");
    const body = await json<Res>(await desk({ memberId: member.id }));
    expect(body.status).toBe("accepted");
    expect(body.warning).toMatch(/expired 5 day.*grace/);
    expect(await rows(member.id)).toBe(1);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).riskStatus).toBe("AT_RISK");
  });

  it("expired membership is accepted when the gym does not require an active membership", async () => {
    const { gym, plan } = await makeGym();
    await prisma.gym.update({ where: { id: gym.id }, data: { settings: { attendance: { requireActiveMembership: false } } } });
    const member = await makeMember(gym.id);
    const today = localDate(new Date(), gym.timezone);
    await giveMembership(gym.id, member.id, plan.id, addDays(today, -90), addDays(today, -40));
    await signInStaff(gym.id, "OWNER");
    expect((await json<Res>(await desk({ memberId: member.id }))).status).toBe("accepted");
    expect(await rows(member.id)).toBe(1);
  });

  it("an at-risk member with an active membership returns to ACTIVE and the change is recorded in riskHistory", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { riskStatus: "AT_RISK" } });
    await signInStaff(gym.id, "OWNER");
    await desk({ memberId: member.id });
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).riskStatus).toBe("ACTIVE");
    const h = await prisma.riskHistory.findMany({ where: { memberId: member.id } });
    expect(h).toHaveLength(1);
    expect([h[0]!.fromStatus, h[0]!.toStatus]).toEqual(["AT_RISK", "ACTIVE"]);
  });
});

describe("member pass (/api/me/pass) and pass check-in", () => {
  it("a signed-in member gets a pass token + QR that the desk can scan once", async () => {
    const { gym, member } = await gymWithMember();
    await signInMember(gym.id, member.id);
    const res = await pass(req("/api/me/pass"));
    expect(res.status).toBe(200);
    const body = await json<{ token: string; qr: string; expiresInSeconds: number }>(res);
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
    expect(body.expiresInSeconds).toBe(300);
    signOut();
    await signInStaff(gym.id, "STAFF");
    const scan = await json<Res>(await desk({ passToken: body.token }));
    expect(scan.status).toBe("accepted");
    expect(scan.memberName).toBe(member.fullName);
    expect(await rows(member.id)).toBe(1);
  });

  it("pass is refused when anonymous", async () => {
    expect((await pass(req("/api/me/pass"))).status).toBe(401);
  });

  it("an expired (>5 min) or tampered pass is refused and writes nothing", async () => {
    const { gym, member } = await gymWithMember();
    await signInStaff(gym.id, "STAFF");
    const old = memberPassToken(member, Date.now() - 301_000);
    const res = await desk({ passToken: old });
    expect(res.status).toBe(400);
    expect((await desk({ passToken: memberPassToken(member, Date.now() - 200_000) })).status).toBe(200);
    expect(await rows(member.id)).toBe(1);
    const fresh = memberPassToken(member);
    expect((await desk({ passToken: fresh.slice(0, -4) + "AAAA" })).status).toBe(400);
  });
});

describe("kiosk token + member self check-in (/api/gym/kiosk-token, /api/me/checkin)", () => {
  const tokenFromUrl = (url: string) => url.split("/checkin/")[1]!;

  async function kioskFor(gymId: string, qs = "") {
    await signInStaff(gymId, "STAFF");
    const res = await kiosk(req(`/api/gym/kiosk-token${qs}`));
    expect(res.status).toBe(200);
    const body = await json<{ url: string; expiresInSeconds: number }>(res);
    signOut();
    return body;
  }

  it("scanning the kiosk QR checks the member in with method QR, attributed to the primary branch", async () => {
    const { gym, member } = await gymWithMember();
    const primary = await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const k = await kioskFor(gym.id);
    expect(k.expiresInSeconds).toBeGreaterThan(0);
    expect(k.expiresInSeconds).toBeLessThanOrEqual(60);
    await signInMember(gym.id, member.id);
    const res = await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }));
    expect(res.status).toBe(200);
    expect((await json<Res>(res)).status).toBe("accepted");
    const a = await prisma.attendance.findMany({ where: { memberId: member.id } });
    expect(a).toHaveLength(1);
    expect(a[0]!.method).toBe("QR");
    expect(a[0]!.locationId).toBe(primary.id);
    // second scan same day -> duplicate
    const again = await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }));
    expect((await json<Res>(again)).status).toBe("duplicate");
    expect(await rows(member.id)).toBe(1);
  });

  it("concurrent self scans yield exactly one attendance row", async () => {
    const { gym, member } = await gymWithMember();
    const k = await kioskFor(gym.id);
    await signInMember(gym.id, member.id);
    const rs = await Promise.all([1, 2, 3].map(() => selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }))));
    const bodies = await Promise.all(rs.map((r) => json<Res>(r)));
    expect(bodies.filter((b) => b.status === "accepted")).toHaveLength(1);
    expect(await rows(member.id)).toBe(1);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).totalVisits).toBe(1);
  });

  it("refuses garbage, expired, and other-gym kiosk tokens", async () => {
    const a = await gymWithMember();
    const b = await gymWithMember();
    await signInMember(a.gym.id, a.member.id);
    const try_ = (token: string) => selfCheckin(req("/api/me/checkin", { body: { token } }));
    expect((await try_("not-a-real-token-at-all")).status).toBe(400);
    expect((await try_(kioskToken(a.gym, Date.now() - 5 * 60_000).token)).status).toBe(400); // 5 windows old
    expect((await try_(kioskToken(b.gym).token)).status).toBe(400); // another gym's code
    expect((await selfCheckin(req("/api/me/checkin", { body: { token: "x" } }))).status).toBe(400); // too short
    expect(await rows(a.member.id)).toBe(0);
    // the previous window is still accepted (grace for slow scans)
    expect((await try_(kioskToken(a.gym, Date.now() - 60_000).token)).status).toBe(200);
    expect(await rows(a.member.id)).toBe(1);
  });

  it("refused when the gym turned self check-in off, and when anonymous", async () => {
    const { gym, member } = await gymWithMember({ attendance: { allowSelfQr: false } });
    const k = await kioskFor(gym.id);
    expect((await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }))).status).toBe(401);
    await signInMember(gym.id, member.id);
    expect((await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }))).status).toBe(403);
    expect(await rows(member.id)).toBe(0);
  });

  it("a suspended member cannot self check-in", async () => {
    const { gym, member } = await gymWithMember();
    const k = await kioskFor(gym.id);
    await signInMember(gym.id, member.id);
    await prisma.member.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });
    expect((await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }))).status).toBe(403);
    expect(await rows(member.id)).toBe(0);
  });

  it("an expired membership cannot self check-in (400, REJECTED logged)", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    const today = localDate(new Date(), gym.timezone);
    await giveMembership(gym.id, member.id, plan.id, addDays(today, -90), addDays(today, -30));
    const k = await kioskFor(gym.id);
    await signInMember(gym.id, member.id);
    expect((await selfCheckin(req("/api/me/checkin", { body: { token: tokenFromUrl(k.url) } }))).status).toBe(400);
    expect(await rows(member.id)).toBe(0);
    expect(await log(member.id, "REJECTED")).toBe(1);
  });

  it("kiosk token needs a signed-in staff member", async () => {
    expect((await kiosk(req("/api/gym/kiosk-token"))).status).toBe(401);
  });
});

describe("device / NFC check-in (/api/devices/checkin)", () => {
  const tap = (key: string | null, body: unknown = { credentialUid: "NFC-AAA" }, scheme = "Device") =>
    deviceCheckin(req("/api/devices/checkin", { body, headers: key === null ? {} : { authorization: `${scheme} ${key}` } }));

  it("unknown / missing / malformed credentials -> 401", async () => {
    expect((await tap(null)).status).toBe(401);
    expect((await tap("totally-unknown-key")).status).toBe(401);
    const { gym } = await gymWithMember();
    const { key } = await makeDevice(gym.id);
    expect((await tap(key, undefined, "Bearer")).status).toBe(401);
    expect((await tap("")).status).toBe(401);
  });

  it("an inactive device -> 401 and nothing recorded", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-OFF" } });
    const { key } = await makeDevice(gym.id, { active: false });
    expect((await tap(key, { credentialUid: "NFC-OFF" })).status).toBe(401);
    expect(await rows(member.id)).toBe(0);
  });

  it("a suspended gym -> 403 gym_suspended; an archived gym too; TRIAL still works", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-SUSP" } });
    const { key } = await makeDevice(gym.id);
    await prisma.gym.update({ where: { id: gym.id }, data: { status: "SUSPENDED" } });
    const res = await tap(key, { credentialUid: "NFC-SUSP" });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("gym_suspended");
    await prisma.gym.update({ where: { id: gym.id }, data: { status: "ARCHIVED" } });
    expect((await tap(key, { credentialUid: "NFC-SUSP" })).status).toBe(403);
    expect(await rows(member.id)).toBe(0);
    await prisma.gym.update({ where: { id: gym.id }, data: { status: "TRIAL" } });
    expect((await tap(key, { credentialUid: "NFC-SUSP" })).status).toBe(200);
    expect(await rows(member.id)).toBe(1);
  });

  it("a registered card checks the member in (method NFC), updates lastSeenAt, then reports duplicate", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-OK" } });
    const { device, key } = await makeDevice(gym.id);
    expect(device.lastSeenAt).toBeNull();
    const res = await tap(key, { credentialUid: "NFC-OK" });
    expect(res.status).toBe(200);
    const body = await json<Res>(res);
    expect(body.status).toBe("accepted");
    expect(body.memberName).toBe(member.fullName.split(" ")[0]);
    const a = await prisma.attendance.findMany({ where: { memberId: member.id } });
    expect(a.map((x) => x.method)).toEqual(["NFC"]);
    expect((await prisma.checkInDevice.findUniqueOrThrow({ where: { id: device.id } })).lastSeenAt).not.toBeNull();
    const log1 = await prisma.checkIn.findMany({ where: { memberId: member.id } });
    expect(log1.map((c) => [c.outcome, c.deviceId])).toEqual([["ACCEPTED", device.id]]);
    expect((await json<Res>(await tap(key, { credentialUid: "NFC-OK" }))).status).toBe("duplicate");
    expect(await rows(member.id)).toBe(1);
  });

  it("a KIOSK device records method KIOSK", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "KIOSK-1" } });
    const { key } = await makeDevice(gym.id, { kind: "KIOSK" });
    await tap(key, { credentialUid: "KIOSK-1" });
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: member.id } })).method).toBe("KIOSK");
  });

  it("an unregistered card -> 404 and no attendance; a card belonging to another gym's member -> 404", async () => {
    const mine = await gymWithMember();
    const theirs = await gymWithMember();
    await prisma.member.update({ where: { id: theirs.member.id }, data: { credentialUid: "THEIR-CARD" } });
    const { key } = await makeDevice(mine.gym.id);
    expect((await tap(key, { credentialUid: "NOBODY-CARD" })).status).toBe(404);
    expect((await tap(key, { credentialUid: "THEIR-CARD" })).status).toBe(404);
    expect(await rows(theirs.member.id)).toBe(0);
  });

  it("an archived member's card is refused (404)", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-ARCH", archivedAt: new Date() } });
    const { key } = await makeDevice(gym.id);
    expect((await tap(key, { credentialUid: "NFC-ARCH" })).status).toBe(404);
    expect(await rows(member.id)).toBe(0);
  });

  it("validates the body (uid too short) -> 400", async () => {
    const { gym } = await gymWithMember();
    const { key } = await makeDevice(gym.id);
    expect((await tap(key, { credentialUid: "a" })).status).toBe(400);
    expect((await tap(key, {})).status).toBe(400);
  });

  it("an expired membership is rejected through the device too (400, REJECTED logged with the device)", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-EXP" } });
    const today = localDate(new Date(), gym.timezone);
    await giveMembership(gym.id, member.id, plan.id, addDays(today, -90), addDays(today, -30));
    const { device, key } = await makeDevice(gym.id);
    expect((await tap(key, { credentialUid: "NFC-EXP" })).status).toBe(400);
    expect(await rows(member.id)).toBe(0);
    const c = await prisma.checkIn.findFirstOrThrow({ where: { memberId: member.id } });
    expect([c.outcome, c.deviceId]).toEqual(["REJECTED", device.id]);
  });

  it("concurrent taps of the same card create exactly one attendance", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-RACE" } });
    const { key } = await makeDevice(gym.id);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => tap(key, { credentialUid: "NFC-RACE" })));
    const bodies = await Promise.all(rs.map((r) => json<Res>(r)));
    expect(bodies.filter((b) => b.status === "accepted")).toHaveLength(1);
    expect(await rows(member.id)).toBe(1);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).totalVisits).toBe(1);
  });

  it("the device key is stored hashed and a different gym's key can't reach this gym's members", async () => {
    const a = await gymWithMember();
    const b = await gymWithMember();
    await prisma.member.update({ where: { id: a.member.id }, data: { credentialUid: "A-ONLY" } });
    const devB = await makeDevice(b.gym.id);
    expect((await prisma.checkInDevice.findFirstOrThrow({ where: { id: devB.device.id } })).keyHash).toBe(sha256(devB.key));
    expect((await tap(devB.key, { credentialUid: "A-ONLY" })).status).toBe(404);
    expect(await rows(a.member.id)).toBe(0);
  });
});

describe("branch / location check-in", () => {
  it("first branch becomes primary; a second needs the multi_location flag; duplicate names are refused", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    const first = await addLocation(req("/api/gym/locations", { body: { name: "Thamel" } }));
    expect(first.status).toBe(200);
    expect((await json<{ isPrimary: boolean }>(first)).isPrimary).toBe(true);
    const second = await addLocation(req("/api/gym/locations", { body: { name: "Patan" } }));
    expect(second.status).toBe(400);
    expect(await prisma.location.count({ where: { gymId: gym.id } })).toBe(1);
    await enableMulti(gym.id);
    const ok = await addLocation(req("/api/gym/locations", { body: { name: "Patan" } }));
    expect(ok.status).toBe(200);
    expect((await json<{ isPrimary: boolean }>(ok)).isPrimary).toBe(false);
    expect((await addLocation(req("/api/gym/locations", { body: { name: "patan" } }))).status).toBe(400);
    const list = await json<{ name: string; isPrimary: boolean }[]>(await listLocations(req("/api/gym/locations")));
    expect(list.map((l) => l.name)).toEqual(["Thamel", "Patan"]);
  });

  it("only users with settings.manage can add branches", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "STAFF");
    expect((await addLocation(req("/api/gym/locations", { body: { name: "Hidden" } }))).status).toBe(403);
    expect(await prisma.location.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("desk check-in at a chosen branch records that branch; without one it records the primary", async () => {
    const { gym, member } = await gymWithMember();
    const m2 = await makeMember(gym.id);
    await giveMembership(gym.id, m2.id, (await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } })).id, "2020-01-01", "2040-01-01");
    const main = await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const east = await prisma.location.create({ data: { gymId: gym.id, name: "East" } });
    await signInStaff(gym.id, "STAFF");
    await desk({ memberId: member.id, locationId: east.id });
    await desk({ memberId: m2.id });
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: member.id } })).locationId).toBe(east.id);
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: m2.id } })).locationId).toBe(main.id);
  });

  it("unknown, closed, or other-gym branch ids are refused (400) and nothing is recorded", async () => {
    const { gym, member } = await gymWithMember();
    const other = await gymWithMember();
    await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const closed = await prisma.location.create({ data: { gymId: gym.id, name: "Closed", active: false } });
    const foreign = await prisma.location.create({ data: { gymId: other.gym.id, name: "Foreign", isPrimary: true } });
    await signInStaff(gym.id, "STAFF");
    for (const id of ["nope", closed.id, foreign.id]) expect((await desk({ memberId: member.id, locationId: id })).status).toBe(400);
    expect(await rows(member.id)).toBe(0);
  });

  it("kiosk token for a branch is signed with that branch; self check-in lands there; a branch closed after the QR was shown falls back to primary", async () => {
    const { gym, member } = await gymWithMember();
    const m2 = await makeMember(gym.id);
    await giveMembership(gym.id, m2.id, (await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } })).id, "2020-01-01", "2040-01-01");
    const main = await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const east = await prisma.location.create({ data: { gymId: gym.id, name: "East" } });
    await signInStaff(gym.id, "STAFF");
    const url = (await json<{ url: string }>(await kiosk(req(`/api/gym/kiosk-token?locationId=${east.id}`)))).url;
    const token = url.split("/checkin/")[1]!;
    expect((await kiosk(req("/api/gym/kiosk-token?locationId=bogus"))).status).toBe(400);
    signOut();
    await signInMember(gym.id, member.id);
    await selfCheckin(req("/api/me/checkin", { body: { token } }));
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: member.id } })).locationId).toBe(east.id);
    // east closes; the same QR still checks a second member in, at the main branch
    await prisma.location.update({ where: { id: east.id }, data: { active: false } });
    signOut();
    await signInMember(gym.id, m2.id);
    expect((await selfCheckin(req("/api/me/checkin", { body: { token } }))).status).toBe(200);
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: m2.id } })).locationId).toBe(main.id);
  });

  it("device bound to a branch attributes check-ins to it", async () => {
    const { gym, member } = await gymWithMember();
    await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const east = await prisma.location.create({ data: { gymId: gym.id, name: "East" } });
    await prisma.member.update({ where: { id: member.id }, data: { credentialUid: "NFC-EAST" } });
    const { key } = await makeDevice(gym.id, { locationId: east.id });
    await deviceCheckin(req("/api/devices/checkin", { body: { credentialUid: "NFC-EAST" }, headers: { authorization: `Device ${key}` } }));
    expect((await prisma.attendance.findFirstOrThrow({ where: { memberId: member.id } })).locationId).toBe(east.id);
  });

  it("the primary branch can't be closed or demoted; making another primary leaves exactly one primary", async () => {
    const { gym } = await makeGym();
    await enableMulti(gym.id);
    const main = await prisma.location.create({ data: { gymId: gym.id, name: "Main", isPrimary: true } });
    const east = await prisma.location.create({ data: { gymId: gym.id, name: "East" } });
    await signInStaff(gym.id, "OWNER");
    const patch = (id: string, body: unknown) => patchLocation(req(`/api/gym/locations/${id}`, { method: "PATCH", body }), params({ id }));
    expect((await patch(main.id, { active: false })).status).toBe(400);
    expect((await patch(main.id, { isPrimary: false })).status).toBe(400);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: main.id } })).active).toBe(true);
    expect((await patch(east.id, { isPrimary: true })).status).toBe(200);
    const all = await prisma.location.findMany({ where: { gymId: gym.id } });
    expect(all.filter((l) => l.isPrimary).map((l) => l.id)).toEqual([east.id]);
    expect((await patch(main.id, { active: false })).status).toBe(200);
    // a closed branch can't be promoted without reopening
    expect((await patch(main.id, { isPrimary: true })).status).toBe(400);
    // another gym's staff cannot touch this branch
    signOut();
    const o = await makeGym();
    await signInStaff(o.gym.id, "OWNER");
    expect((await patch(east.id, { name: "Hijacked" })).status).toBe(404);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: east.id } })).name).toBe("East");
  });

  it("visitsByLocation counts per branch and reports unattributed visits as 'Not recorded'", async () => {
    const { visitsByLocation } = await import("@/services/locations");
    const { gym, member } = await gymWithMember();
    const m2 = await makeMember(gym.id);
    const m3 = await makeMember(gym.id);
    const east = await prisma.location.create({ data: { gymId: gym.id, name: "East", isPrimary: true } });
    const d = toDbDate("2026-04-10");
    await prisma.attendance.createMany({ data: [
      { gymId: gym.id, memberId: member.id, localDate: d, checkedInAt: new Date(), method: "STAFF", locationId: east.id },
      { gymId: gym.id, memberId: m2.id, localDate: d, checkedInAt: new Date(), method: "STAFF", locationId: east.id },
      { gymId: gym.id, memberId: m3.id, localDate: d, checkedInAt: new Date(), method: "STAFF" },
    ] });
    const v = await visitsByLocation(gym.id, toDbDate("2026-04-01"), toDbDate("2026-05-01"));
    expect(v.map((x) => [x.name, x.visits])).toEqual([["East", 2], ["Not recorded", 1]]);
    expect(await visitsByLocation(gym.id, toDbDate("2026-05-01"), toDbDate("2026-06-01"))).toEqual([]);
  });
});
