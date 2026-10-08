import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit, securityEvent } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

export const PATCH = adminRoute({ permission: "admins.manage" }, async (ctx, req, params) => {
  const a = await prisma.platformAdmin.findUnique({ where: { id: String(params.id) } });
  if (!a) throw notFound();
  const b = await parseJson(req, z.object({ role: z.enum(["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"]) }));
  if (a.id === ctx.admin.id) throw badRequest("You can't change your own role.");
  if (a.role === "SUPER_ADMIN" && b.role !== "SUPER_ADMIN" && (await prisma.platformAdmin.count({ where: { role: "SUPER_ADMIN", disabledAt: null } })) <= 1) throw badRequest("There must be at least one super admin.");
  const after = await prisma.platformAdmin.update({ where: { id: a.id }, data: { role: b.role } });
  await prisma.adminSession.updateMany({ where: { adminId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actor: ctx.actor, action: "admins.role_changed", entityType: "PlatformAdmin", entityId: a.id, before: { role: a.role }, after: b });
  await securityEvent({ type: "PRIVILEGE_CHANGE", actorType: "PLATFORM_ADMIN", adminId: a.id, details: { by: ctx.admin.id, from: a.role, to: b.role } });
  return { id: after.id, role: after.role };
});
