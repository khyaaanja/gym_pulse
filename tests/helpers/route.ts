import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import type { PlatformRole, StaffRole } from "@/generated/prisma/client";

/**
 * Shared harness for calling route handlers directly. Route wrappers read cookies through next/headers, so a test
 * file mocks that module with the jar below:
 *
 *   vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
 *
 * then signs in with one of the helpers (each sets the cookie the wrappers look for).
 */
type Jar = { user: string; admin: string; set: Map<string, string> };
const g = globalThis as typeof globalThis & { __routeJar?: Jar };
export const jar: Jar = (g.__routeJar ??= { user: "", admin: "", set: new Map() });

export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) => {
      const value = name === "gp_session" ? jar.user : name === "gp_admin" ? jar.admin : "";
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => void jar.set.set(name, value),
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
};

export function signOut() {
  jar.user = "";
  jar.admin = "";
  jar.set.clear();
}

let n = 0;
export const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const email = (tag: string) => `${tag}-${uid()}@example.test`.toLowerCase();

let ip = 0;
const nextIp = () => `10.77.${(ip >> 8) & 255}.${ip++ & 255}`;

/** A same-origin request from its own address (so per-IP rate limits don't couple tests). */
export function req(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "x-forwarded-for": nextIp(), ...opts.headers };
  if (method !== "GET" && method !== "HEAD") {
    headers.origin ??= "http://localhost:3000";
    headers["content-type"] ??= "application/json";
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

export const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });
export const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
export const errCode = async (res: Response) => (await json<{ error?: { code?: string } }>(res.clone())).error?.code;

export async function makeUser(name = "Test user") {
  return prisma.user.create({ data: { name, email: email("user") } });
}

/** Signs the given user in (MFA already verified) with `gymId` as the active gym. */
export async function signInUser(userId: string, gymId?: string) {
  const token = randomToken();
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), activeGymId: gymId ?? null } });
  jar.user = token;
  return token;
}

export async function signInStaff(gymId: string, role: StaffRole, over: { grantedPermissions?: string[]; revokedPermissions?: string[] } = {}) {
  const user = await makeUser(`${role} person`);
  const staff = await prisma.staffMember.create({ data: { gymId, userId: user.id, role, grantedPermissions: over.grantedPermissions ?? [], revokedPermissions: over.revokedPermissions ?? [] } });
  await signInUser(user.id, gymId);
  return { user, staff };
}

/** A member with a linked login, signed in. */
export async function signInMember(gymId: string, memberId: string) {
  const user = await makeUser("Member person");
  await prisma.member.update({ where: { id: memberId }, data: { userId: user.id } });
  await signInUser(user.id, gymId);
  return { user };
}

export async function signInAdmin(role: PlatformRole) {
  const admin = await prisma.platformAdmin.create({ data: { email: email(`admin-${role.toLowerCase()}`), name: `${role} admin`, passwordHash: "x", role, mfaEnabled: true } });
  const token = randomToken();
  await prisma.adminSession.create({ data: { tokenHash: sha256(token), adminId: admin.id, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
  jar.admin = token;
  return admin;
}
