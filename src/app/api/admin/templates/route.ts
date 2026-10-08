import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { TEMPLATE_KEYS } from "@/services/notifications/templates";

export const GET = adminRoute({ permission: "notifications.manage" }, async () => ({
  keys: TEMPLATE_KEYS,
  templates: await prisma.notificationTemplate.findMany({ where: { gymId: null }, orderBy: [{ key: "asc" }, { channel: "asc" }, { version: "desc" }] }),
}));

/** Creates a new DRAFT version; publishing is a separate step (Draft → Review → Published → Archived). */
export const POST = adminRoute({ permission: "notifications.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ key: z.enum(Object.keys(TEMPLATE_KEYS) as [string, ...string[]]), channel: z.enum(["EMAIL", "SMS", "WHATSAPP", "PUSH", "IN_APP"]), subject: z.string().max(160).nullable().optional(), body: z.string().trim().min(5).max(2000) }));
  const latest = await prisma.notificationTemplate.findFirst({ where: { gymId: null, key: b.key, channel: b.channel }, orderBy: { version: "desc" } });
  const t = await prisma.notificationTemplate.create({ data: { gymId: null, key: b.key, channel: b.channel, name: TEMPLATE_KEYS[b.key as keyof typeof TEMPLATE_KEYS], subject: b.subject, body: b.body, status: "DRAFT", version: (latest?.version ?? 0) + 1, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "templates.draft_created", entityType: "NotificationTemplate", entityId: t.id, after: t });
  return t;
});
