import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const GET = adminRoute({ permission: "settings.manage" }, async () => prisma.platformSetting.findMany({ orderBy: { key: "asc" } }));

export const PUT = adminRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ key: z.string().regex(/^[a-zA-Z.]{3,60}$/), value: z.unknown(), description: z.string().max(200).optional() }));
  const before = await prisma.platformSetting.findUnique({ where: { key: b.key } });
  const s = await prisma.platformSetting.upsert({ where: { key: b.key }, create: { key: b.key, value: b.value as never, description: b.description, updatedById: ctx.admin.id }, update: { value: b.value as never, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "settings.platform_changed", entityType: "PlatformSetting", entityId: b.key, before: before?.value, after: b.value });
  return s;
});
