import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit, securityEvent } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { OWNER_ONLY, PERMISSIONS } from "@/lib/rbac";
import { revokeAllUserSessions } from "@/lib/auth/session";

const perm = z.enum(PERMISSIONS);
const schema = z.object({
  role: z.enum(["MANAGER", "STAFF", "TRAINER"]).optional(),
  grantedPermissions: z.array(perm).max(30).optional(),
  revokedPermissions: z.array(perm).max(30).optional(),
  active: z.boolean().optional(),
  title: z.string().max(60).nullable().optional(),
});

export const PATCH = gymRoute({ permission: "staff.manage" }, async (ctx, req, params) => {
  const s = await ctx.db.staffMember.findUnique({ where: { id: String(params.id) } });
  if (!s) throw notFound();
  if (s.role === "OWNER") throw badRequest("The owner's access can't be changed here.");
  if (s.userId === ctx.user.id) throw badRequest("You can't change your own access.");
  const b = await parseJson(req, schema);
  if (b.grantedPermissions?.some((p) => OWNER_ONLY.includes(p))) throw badRequest("Billing and staff management stay with the owner.");
  const after = await ctx.db.staffMember.update({ where: { id: s.id }, data: b });
  if (b.active === false) await revokeAllUserSessions(s.userId);
  await audit({ actor: ctx.actor, action: "staff.permissions_changed", entityType: "StaffMember", entityId: s.id, gymId: ctx.gym.id, before: s, after: b });
  await securityEvent({ type: "PRIVILEGE_CHANGE", actorType: "USER", userId: s.userId, gymId: ctx.gym.id, ip: ctx.meta.ip, details: { by: ctx.user.id, change: b } });
  return after;
});
