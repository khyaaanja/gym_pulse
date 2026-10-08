import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const PATCH = adminRoute({ permission: "announcements.manage" }, async (ctx, req, params) => {
  const { status } = await parseJson(req, z.object({ status: z.enum(["DRAFT", "PUBLISHED", "EXPIRED"]) }));
  const a = await prisma.announcement.update({ where: { id: String(params.id) }, data: { status, ...(status === "PUBLISHED" ? { publishAt: new Date() } : {}), ...(status === "EXPIRED" ? { expiresAt: new Date() } : {}) } });
  await audit({ actor: ctx.actor, action: `announcements.${status.toLowerCase()}`, entityType: "Announcement", entityId: a.id });
  return a;
});
