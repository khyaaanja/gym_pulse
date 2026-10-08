import { cookies, headers } from "next/headers";
import { prisma } from "@/db/client";
import { randomToken, sha256, signPayload, verifyPayload } from "@/lib/crypto";
import { securityEvent } from "@/lib/audit";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { AppError, tooMany } from "@/lib/errors";
import { hashPassword, verifyPassword } from "./password";
import { verifyTotp } from "./mfa";
import { normalizeNepalPhone } from "@/lib/phone";
import { clientIp } from "@/lib/client-ip";
import type { PlatformAdmin, User } from "@/generated/prisma/client";

export const USER_COOKIE = "gp_session";
export const ADMIN_COOKIE = "gp_admin";

const USER_ABSOLUTE_MS = 30 * 86_400_000;
const USER_IDLE_MS = 7 * 86_400_000;
const ADMIN_ABSOLUTE_MS = 12 * 3_600_000;
const ADMIN_IDLE_MS = 30 * 60_000;
const TOUCH_EVERY_MS = 5 * 60_000;
const DEVICE_COOKIE = "gp_device";
const DEVICE_MS = 365 * 86_400_000;

export type RequestMeta = { ip: string | null; userAgent: string | null };

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent") };
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.APP_ENV === "production" || process.env.APP_URL?.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

// ─────────────────────────────── Sign-in throttling ───────────────────────────────

/*
 * Wrong passwords never lock an account: a lock anyone can trigger is a way to keep the owner out. Instead:
 *  - each address gets a few tries per account (an attacker only blocks themselves),
 *  - each account has a higher ceiling across all addresses (stops guessing spread over many IPs),
 *  - a browser that has signed in to the account before carries a signed device cookie and skips that ceiling,
 *    so the real owner still gets in while the account is under attack.
 */
type LoginKind = "user" | "admin";
const LOGIN_LIMITS: Record<LoginKind, { prefix: string; perIp: number; perAddressAndAccount: number; perAccount: number }> = {
  user: { prefix: "login", perIp: 30, perAddressAndAccount: 5, perAccount: 50 },
  admin: { prefix: "admin-login", perIp: 15, perAddressAndAccount: 5, perAccount: 20 },
};

async function knownDevice(kind: LoginKind, accountId: string) {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  const p = token ? verifyPayload<{ k?: string; a?: string[] }>(token) : null;
  return p?.k === "device" && Array.isArray(p.a) && p.a.includes(`${kind}:${accountId}`);
}

async function rememberDevice(kind: LoginKind, accountId: string) {
  const jar = await cookies();
  const prior = verifyPayload<{ k?: string; a?: string[] }>(jar.get(DEVICE_COOKIE)?.value ?? "");
  const accounts = [`${kind}:${accountId}`, ...(prior?.k === "device" && Array.isArray(prior.a) ? prior.a : [])];
  const expires = new Date(Date.now() + DEVICE_MS);
  jar.set(DEVICE_COOKIE, signPayload({ k: "device", a: [...new Set(accounts)].slice(0, 5) }), cookieOptions(expires));
}

async function throttleLogin(kind: LoginKind, id: string, accountId: string | null, meta: RequestMeta) {
  const l = LOGIN_LIMITS[kind];
  const ip = meta.ip ?? "unknown";
  const limited = async (key: string, limit: number, scope: string) => {
    try {
      await rateLimit(key, limit, 900);
    } catch (err) {
      await securityEvent({ type: "LOGIN_THROTTLED", actorType: kind === "admin" ? "PLATFORM_ADMIN" : "USER", email: id, ...meta, details: { scope } });
      throw err;
    }
  };
  await limited(`${l.prefix}:ip:${ip}`, l.perIp, "address");
  await limited(`${l.prefix}:id-ip:${sha256(id)}:${ip}`, l.perAddressAndAccount, "address+account");
  if (!(accountId && (await knownDevice(kind, accountId)))) await limited(`${l.prefix}:id:${id}`, l.perAccount, "account");
}

// ─────────────────────────────── Gym / member / vendor users ───────────────────────────────

export type LoginResult = { needsMfa: boolean; needsMfaEnrollment: boolean; mustResetPassword: boolean };

export async function loginUser(identifier: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const id = identifier.trim().toLowerCase();
  const phone = normalizeNepalPhone(id);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: id }, ...(phone ? [{ phone }] : [])] } });
  await throttleLogin("user", id, user?.id ?? null, meta);
  const now = new Date();

  if (user?.lockedUntil && user.lockedUntil > now) {
    await securityEvent({ type: "LOGIN_BLOCKED_LOCKED", actorType: "USER", userId: user.id, email: id, ...meta });
    throw tooMany("This account is temporarily locked. Try again later, or reset your password.");
  }

  const ok = await verifyPassword(user?.passwordHash, password);
  if (!user || !ok || user.disabledAt) {
    // Counted for the security dashboard; throttling (above) does the protecting, never a lock.
    if (user && !user.disabledAt) await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
    await securityEvent({ type: "LOGIN_FAILED", actorType: "USER", userId: user?.id, email: id, ...meta, details: { disabled: !!user?.disabledAt } });
    throw new AppError(401, "invalid_credentials", "That email/phone and password don't match.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastLoginAt: now } });
  await resetRateLimit(`login:id-ip:${sha256(id)}:${meta.ip ?? "unknown"}`);
  await rememberDevice("user", user.id);
  await createUserSession(user, meta, !user.mfaEnabled);
  await securityEvent({ type: "LOGIN_SUCCESS", actorType: "USER", userId: user.id, email: id, ...meta });
  return {
    needsMfa: user.mfaEnabled,
    needsMfaEnrollment: user.mfaRequired && !user.mfaEnabled,
    mustResetPassword: user.mustResetPassword,
  };
}

export async function createUserSession(user: Pick<User, "id">, meta: RequestMeta, mfaVerified: boolean, activeGymId?: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + USER_ABSOLUTE_MS);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      mfaVerifiedAt: mfaVerified ? new Date() : null,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
      expiresAt,
      activeGymId: activeGymId ?? null,
    },
  });
  (await cookies()).set(USER_COOKIE, token, cookieOptions(expiresAt));
  return token;
}

export type UserSession = NonNullable<Awaited<ReturnType<typeof loadUserSession>>>;

async function loadUserSession(token: string) {
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > USER_IDLE_MS) return null;
  if (session.user.disabledAt) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

/** Account setup a user must finish before using the app: set up MFA when required, or replace a temporary password. */
export type SetupStep = "mfa_enrollment" | "password_reset";

export function pendingSetup(user: Pick<User, "mfaRequired" | "mfaEnabled" | "mustResetPassword">): SetupStep | null {
  if (user.mfaRequired && !user.mfaEnabled) return "mfa_enrollment";
  if (user.mustResetPassword) return "password_reset";
  return null;
}

export const SETUP_PATH: Record<SetupStep, string> = { mfa_enrollment: "/app/security?enroll=1", password_reset: "/app/security?reset=1" };

/**
 * The signed-in user's session, or null. `requireMfa` (default true) treats a session that
 * hasn't completed the second factor as signed-out for everything except the MFA step itself.
 * A session with account setup still pending (see pendingSetup) also counts as signed-out unless
 * `allowSetup` is set — only the setup screens and endpoints pass it, so anything else fails closed.
 */
export async function getUserSession(opts: { requireMfa?: boolean; allowSetup?: boolean; token?: string } = {}) {
  const token = opts.token ?? (await cookies()).get(USER_COOKIE)?.value;
  if (!token) return null;
  const session = await loadUserSession(token);
  if (!session) return null;
  if ((opts.requireMfa ?? true) && session.user.mfaEnabled && !session.mfaVerifiedAt) return null;
  if (!opts.allowSetup && pendingSetup(session.user)) return null;
  return session;
}

export async function verifyUserMfa(code: string, meta: RequestMeta) {
  const session = await getUserSession({ requireMfa: false });
  if (!session) throw new AppError(401, "unauthorized", "Your sign-in expired. Please sign in again.");
  await rateLimit(`mfa:user:${session.userId}`, 8, 900);
  if (!(await verifyTotp(session.user.mfaSecretEnc, code))) {
    await securityEvent({ type: "MFA_FAILED", actorType: "USER", userId: session.userId, ...meta });
    throw new AppError(401, "invalid_code", "That code isn't right. Check your authenticator app and try again.");
  }
  await prisma.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date() } });
}

export async function logoutUser() {
  const jar = await cookies();
  const token = jar.get(USER_COOKIE)?.value;
  if (token) {
    const hash = sha256(token);
    await prisma.session.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
    // This device stops receiving the signed-out user's pushes immediately.
    await prisma.pushSubscription.deleteMany({ where: { session: { tokenHash: hash } } });
  }
  jar.delete(USER_COOKIE);
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  await prisma.pushSubscription.deleteMany({ where: { userId, ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}) } });
}

// ─────────────────────────────── Platform admins (separate cookie, table and timeouts) ───────────────────────────────

export type AdminLoginResult = { needsMfa: boolean; needsMfaEnrollment: boolean; mustResetPassword: boolean };

export function adminMfaEnforced(admin: Pick<PlatformAdmin, "mfaRequired">) {
  return admin.mfaRequired && process.env.ALLOW_ADMIN_WITHOUT_MFA !== "true";
}

export async function loginAdmin(email: string, password: string, meta: RequestMeta): Promise<AdminLoginResult> {
  const id = email.trim().toLowerCase();
  const admin = await prisma.platformAdmin.findUnique({ where: { email: id } });
  await throttleLogin("admin", id, admin?.id ?? null, meta);
  const now = new Date();
  if (admin?.lockedUntil && admin.lockedUntil > now) {
    await securityEvent({ type: "ADMIN_LOGIN_BLOCKED_LOCKED", actorType: "PLATFORM_ADMIN", adminId: admin.id, email: id, ...meta });
    throw tooMany("This account is temporarily locked. Try again in 15 minutes.");
  }
  const ok = await verifyPassword(admin?.passwordHash, password);
  if (!admin || !ok || admin.disabledAt) {
    if (admin && !admin.disabledAt) await prisma.platformAdmin.update({ where: { id: admin.id }, data: { failedLoginCount: { increment: 1 } } });
    await securityEvent({ type: "ADMIN_LOGIN_FAILED", actorType: "PLATFORM_ADMIN", adminId: admin?.id, email: id, ...meta });
    throw new AppError(401, "invalid_credentials", "Those credentials don't match.");
  }
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lastLoginAt: now } });
  await resetRateLimit(`admin-login:id-ip:${sha256(id)}:${meta.ip ?? "unknown"}`);
  await rememberDevice("admin", admin.id);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + ADMIN_ABSOLUTE_MS);
  await prisma.adminSession.create({
    data: {
      tokenHash: sha256(token),
      adminId: admin.id,
      mfaVerifiedAt: admin.mfaEnabled ? null : new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
      expiresAt,
    },
  });
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(expiresAt));
  await securityEvent({ type: "ADMIN_LOGIN_SUCCESS", actorType: "PLATFORM_ADMIN", adminId: admin.id, email: id, ...meta });
  return {
    needsMfa: admin.mfaEnabled,
    needsMfaEnrollment: !admin.mfaEnabled && adminMfaEnforced(admin),
    mustResetPassword: admin.mustResetPassword,
  };
}

export type AdminSessionWithAdmin = NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

/**
 * `stage`: "full" requires MFA completed (and enrolled, when enforced); "partial" allows a
 * session that is mid-way through MFA verification or enrollment.
 */
export async function getAdminSession(stage: "full" | "partial" = "full", token?: string) {
  const t = token ?? (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!t) return null;
  const session = await prisma.adminSession.findUnique({ where: { tokenHash: sha256(t) }, include: { admin: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.admin.disabledAt) return null;
  if (Date.now() - session.lastSeenAt.getTime() > ADMIN_IDLE_MS) return null;
  if (stage === "full" && adminSetupStep(session)) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

/**
 * What an admin session still has to do before it is "full": the second factor (verify, or enroll when enforced),
 * then replacing a temporary password. Returns the page for that step, or null when nothing is pending.
 */
export function adminSetupStep(session: { mfaVerifiedAt: Date | null; admin: Pick<PlatformAdmin, "mfaEnabled" | "mfaRequired" | "mustResetPassword"> }) {
  if (session.admin.mfaEnabled ? !session.mfaVerifiedAt : adminMfaEnforced(session.admin)) return "/super-admin/login/mfa";
  if (session.admin.mustResetPassword) return "/super-admin/login/password";
  return null;
}

/**
 * Admin password change. Needs the current password and a session that has completed its second factor, so a
 * stolen password alone can't be used to lock the real admin out. Guesses are rate-limited per admin (never a lock).
 */
export async function changeAdminPassword(session: AdminSessionWithAdmin, current: string, next: string, meta: RequestMeta) {
  if (adminSetupStep(session) === "/super-admin/login/mfa") throw new AppError(403, "mfa_required", "Finish two-step verification first.");
  await rateLimit(`admin-pwchange:${session.adminId}`, 5, 900);
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: session.adminId } });
  if (!(await verifyPassword(admin.passwordHash, current))) {
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { failedLoginCount: { increment: 1 } } });
    await securityEvent({ type: "ADMIN_PASSWORD_CHANGE_FAILED", actorType: "PLATFORM_ADMIN", adminId: admin.id, ...meta });
    throw new AppError(400, "invalid_password", "Your current password isn't right.");
  }
  if (await verifyPassword(admin.passwordHash, next)) throw new AppError(400, "same_password", "Choose a password different from your current one.");
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustResetPassword: false, failedLoginCount: 0, lockedUntil: null } });
  await prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null, id: { not: session.id } }, data: { revokedAt: new Date() } });
  await securityEvent({ type: "ADMIN_PASSWORD_CHANGED", actorType: "PLATFORM_ADMIN", adminId: admin.id, ...meta });
}

export async function verifyAdminMfa(code: string, meta: RequestMeta) {
  const session = await getAdminSession("partial");
  if (!session) throw new AppError(401, "unauthorized", "Your sign-in expired. Please sign in again.");
  await rateLimit(`mfa:admin:${session.adminId}`, 6, 900);
  if (!(await verifyTotp(session.admin.mfaSecretEnc, code))) {
    await securityEvent({ type: "ADMIN_MFA_FAILED", actorType: "PLATFORM_ADMIN", adminId: session.adminId, ...meta });
    throw new AppError(401, "invalid_code", "That code isn't right.");
  }
  await prisma.adminSession.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date() } });
}

export async function logoutAdmin() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await prisma.adminSession.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  jar.delete(ADMIN_COOKIE);
}
