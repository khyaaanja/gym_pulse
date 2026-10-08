import { z } from "zod";
import { adminRoute, parseJson, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit, securityEvent } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { revokeAllUserSessions } from "@/lib/auth/session";

export const GET = adminRoute({ permission: "security.manage" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ type: z.string().max(40).optional() }));
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [events, byType, suspiciousIps, adminSessions, userSessions, privilege] = await Promise.all([
    prisma.securityEvent.findMany({ where: q.type ? { type: q.type } : {}, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.securityEvent.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.securityEvent.groupBy({ by: ["ip"], where: { createdAt: { gte: since }, type: { in: ["LOGIN_FAILED", "ADMIN_LOGIN_FAILED", "MFA_FAILED", "WEBHOOK_SIGNATURE_INVALID"] } }, _count: true, having: { ip: { _count: { gte: 10 } } } }),
    prisma.adminSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, include: { admin: { select: { name: true, email: true, role: true } } }, orderBy: { lastSeenAt: "desc" } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.securityEvent.count({ where: { type: "PRIVILEGE_CHANGE", createdAt: { gte: since } } }),
  ]);
  return { events, byType, suspiciousIps, adminSessions: adminSessions.map(({ tokenHash: _t, ...s }) => s), activeUserSessions: userSessions, privilegeChanges7d: privilege };
});

const actionSchema = z.object({
  action: z.enum(["revoke_sessions", "disable", "enable", "force_password_reset", "require_mfa"]),
  target: z.enum(["user", "admin", "admin_session"]),
  id: z.string().optional(),
  email: z.string().email().optional(),
});

export const POST = adminRoute({ permission: "security.manage" }, async (ctx, req) => {
  const b = await parseJson(req, actionSchema);
  if (b.target === "admin_session") {
    if (!b.id) throw badRequest("Session id required.");
    await prisma.adminSession.update({ where: { id: b.id }, data: { revokedAt: new Date() } });
  } else if (b.target === "user") {
    const user = await prisma.user.findFirst({ where: b.id ? { id: b.id } : { email: b.email?.toLowerCase() } });
    if (!user) throw notFound("User not found.");
    if (b.action === "revoke_sessions") await revokeAllUserSessions(user.id);
    if (b.action === "disable") {
      await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
      await revokeAllUserSessions(user.id);
    }
    if (b.action === "enable") await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null, lockedUntil: null, failedLoginCount: 0 } });
    if (b.action === "force_password_reset") {
      await prisma.user.update({ where: { id: user.id }, data: { mustResetPassword: true } });
      await revokeAllUserSessions(user.id);
    }
    if (b.action === "require_mfa") await prisma.user.update({ where: { id: user.id }, data: { mfaRequired: true } });
    await securityEvent({ type: `ADMIN_ACTION_${b.action.toUpperCase()}`, actorType: "PLATFORM_ADMIN", adminId: ctx.admin.id, userId: user.id, ip: ctx.meta.ip });
  } else {
    const admin = await prisma.platformAdmin.findFirst({ where: b.id ? { id: b.id } : { email: b.email?.toLowerCase() } });
    if (!admin) throw notFound("Admin not found.");
    if (admin.id === ctx.admin.id && (b.action === "disable" || b.action === "revoke_sessions")) throw badRequest("You can't lock yourself out.");
    if (b.action === "revoke_sessions" || b.action === "disable" || b.action === "force_password_reset") await prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (b.action === "disable") await prisma.platformAdmin.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });
    if (b.action === "enable") await prisma.platformAdmin.update({ where: { id: admin.id }, data: { disabledAt: null, lockedUntil: null, failedLoginCount: 0 } });
    if (b.action === "force_password_reset") await prisma.platformAdmin.update({ where: { id: admin.id }, data: { mustResetPassword: true } });
    if (b.action === "require_mfa") await prisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaRequired: true } });
  }
  await audit({ actor: ctx.actor, action: `security.${b.action}`, entityType: b.target, entityId: b.id ?? b.email ?? null });
  return { ok: true };
});
