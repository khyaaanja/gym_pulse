import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

const NEXT: Record<string, string[]> = { DRAFT: ["REVIEW", "ARCHIVED"], REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["ARCHIVED"], ARCHIVED: [] };

export const PATCH = adminRoute({ permission: "notifications.manage" }, async (ctx, req, params) => {
  const t = await prisma.notificationTemplate.findUnique({ where: { id: String(params.id) } });
  if (!t || t.gymId) throw notFound();
  const b = await parseJson(req, z.object({ status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"]).optional(), subject: z.string().max(160).nullable().optional(), body: z.string().trim().min(5).max(2000).optional() }));
  if ((b.subject !== undefined || b.body !== undefined) && t.status !== "DRAFT") throw badRequest("Only drafts can be edited. Create a new version instead.");
  if (b.status && !NEXT[t.status]!.includes(b.status)) throw badRequest(`Can't move a template from ${t.status} to ${b.status}.`);
  const after = await prisma.$transaction(async (tx) => {
    if (b.status === "PUBLISHED") {
      await tx.notificationTemplate.updateMany({ where: { gymId: null, key: t.key, channel: t.channel, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    }
    return tx.notificationTemplate.update({ where: { id: t.id }, data: { ...b, updatedById: ctx.admin.id } });
  });
  await audit({ actor: ctx.actor, action: b.status ? `templates.${b.status.toLowerCase()}` : "templates.edited", entityType: "NotificationTemplate", entityId: t.id, before: t, after });
  return after;
});
