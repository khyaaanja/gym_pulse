import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { makeGym } from "./helpers/fixtures";

// The route wrappers read the session cookie through next/headers; point it at a token each test controls.
const jar = vi.hoisted(() => ({ user: "", admin: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = name === "gp_admin" ? jar.admin : jar.user;
      return value ? { name, value } : undefined;
    },
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));

const { GET: dashboard } = await import("@/app/api/gym/members/route");
const { GET: me } = await import("@/app/api/auth/me/route");
const { POST: changePassword } = await import("@/app/api/auth/password/change/route");
const { GET: listNotifications, POST: markNotificationsRead } = await import("@/app/api/notifications/route");
const { GET: adminGyms } = await import("@/app/api/admin/gyms/route");
const { POST: adminChangePassword } = await import("@/app/api/admin/auth/password/route");
const { getAdminSession } = await import("@/lib/auth/session");

const PASSWORD = "Old-Password-123";
const req = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost:3000" } });
const code = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

async function staffUser(flags: { mustResetPassword?: boolean; mfaRequired?: boolean }) {
  const { gym } = await makeGym();
  const user = await prisma.user.create({ data: { name: "Desk", email: `desk-${randomToken(6)}@example.test`, passwordHash: await hashPassword(PASSWORD), ...flags } });
  await prisma.staffMember.create({ data: { gymId: gym.id, userId: user.id, role: "OWNER" } });
  const token = randomToken();
  await prisma.session.create({ data: { tokenHash: sha256(token), userId: user.id, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), activeGymId: gym.id } });
  jar.user = token;
  return user;
}

async function admin(flags: { mustResetPassword?: boolean }) {
  const a = await prisma.platformAdmin.create({ data: { email: `admin-${randomToken(6)}@example.test`, name: "Admin", role: "SUPER_ADMIN", passwordHash: await hashPassword(PASSWORD), mfaRequired: false, ...flags } });
  const token = randomToken();
  await prisma.adminSession.create({ data: { tokenHash: sha256(token), adminId: a.id, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
  jar.admin = token;
  return a;
}

beforeEach(() => {
  jar.user = "";
  jar.admin = "";
});

describe("a user who must reset their password", () => {
  it("can't use the app until they do", async () => {
    await staffUser({ mustResetPassword: true });
    const res = await dashboard(req("/api/gym/members"));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("account_setup_required");
  });

  it("can still reach the account endpoints, and gets full access after changing it", async () => {
    await staffUser({ mustResetPassword: true });
    expect((await me(req("/api/auth/me"))).status).toBe(200);
    expect((await changePassword(req("/api/auth/password/change", { current: PASSWORD, next: "New-Password-456" }))).status).toBe(200);
    expect((await dashboard(req("/api/gym/members"))).status).toBe(200);
  });
});

describe("notifications while account setup is pending", () => {
  it("are refused (fail closed) for both setup steps, and open up once setup is done", async () => {
    for (const flags of [{ mustResetPassword: true }, { mfaRequired: true }]) {
      const user = await staffUser(flags);
      await prisma.notification.create({ data: { userId: user.id, channel: "IN_APP", category: "SYSTEM", title: "Secret title", body: "Secret body" } });
      const list = await listNotifications(req("/api/notifications"));
      expect(list.status).toBe(403);
      expect(await code(list)).toBe("account_setup_required");
      const mark = await markNotificationsRead(req("/api/notifications", { all: true }));
      expect(mark.status).toBe(403);
      expect(await prisma.notification.count({ where: { userId: user.id, readAt: { not: null } } })).toBe(0);
      await prisma.user.update({ where: { id: user.id }, data: { mustResetPassword: false, mfaEnabled: true } });
      expect((await listNotifications(req("/api/notifications"))).status).toBe(200);
    }
  });
});

describe("a user who must set up two-step verification", () => {
  it("can't use the app until MFA is on", async () => {
    const user = await staffUser({ mfaRequired: true });
    expect(await code(await dashboard(req("/api/gym/members")))).toBe("account_setup_required");
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    expect((await dashboard(req("/api/gym/members"))).status).toBe(200);
  });
});

describe("a platform admin who must reset their password", () => {
  it("has only a partial session until they change it", async () => {
    await admin({ mustResetPassword: true });
    expect(await getAdminSession("full")).toBeNull();
    expect(await getAdminSession("partial")).not.toBeNull();
    const res = await adminGyms(req("/api/admin/gyms"));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("account_setup_required");
  });

  it("can change it (with the current password) and then gets full access", async () => {
    const a = await admin({ mustResetPassword: true });
    expect((await adminChangePassword(req("/api/admin/auth/password", { current: "wrong-password-0", next: "New-Admin-Pass-789" }))).status).toBe(400);
    expect((await adminChangePassword(req("/api/admin/auth/password", { current: PASSWORD, next: "New-Admin-Pass-789" }))).status).toBe(200);
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.id } })).mustResetPassword).toBe(false);
    expect((await adminGyms(req("/api/admin/gyms"))).status).toBe(200);
  });

  it("any admin can change their own password, and other admin sessions are signed out", async () => {
    const a = await admin({});
    const other = randomToken();
    await prisma.adminSession.create({ data: { tokenHash: sha256(other), adminId: a.id, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
    expect((await adminChangePassword(req("/api/admin/auth/password", { current: PASSWORD, next: "Another-Pass-321" }))).status).toBe(200);
    expect((await prisma.adminSession.findUniqueOrThrow({ where: { tokenHash: sha256(other) } })).revokedAt).not.toBeNull();
  });
});
