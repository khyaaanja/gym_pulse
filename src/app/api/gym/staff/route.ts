import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { createInvite } from "@/services/invites";
import { effectivePermissions } from "@/lib/rbac";

export const GET = gymRoute({ permission: "staff.manage" }, async (ctx) => {
  const [staff, invites] = await Promise.all([
    ctx.db.staffMember.findMany({ include: { user: { select: { name: true, email: true, phone: true, lastLoginAt: true, mfaEnabled: true } } }, orderBy: [{ active: "desc" }, { role: "asc" }] }),
    ctx.db.invite.findMany({ where: { role: { not: "MEMBER" }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  return { staff: staff.map((s) => ({ ...s, effective: [...effectivePermissions(s)] })), invites: invites.map(({ tokenHash: _t, ...i }) => i) };
});

export const POST = gymRoute({ permission: "staff.manage", rateLimit: { limit: 30, windowSeconds: 3600 } }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ role: z.enum(["MANAGER", "STAFF", "TRAINER"]), email: z.string().email().optional().nullable(), phone: z.string().max(20).optional().nullable() }));
  const res = await createInvite(ctx.gym, b.role, { email: b.email, phone: b.phone }, ctx.actor);
  return { link: res.link };
});
