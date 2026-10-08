import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

const NEXT: Record<string, string[]> = { DRAFT: ["REVIEW", "ARCHIVED"], REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["ARCHIVED"], ARCHIVED: ["DRAFT"] };

export const PATCH = adminRoute({ permission: "content.manage" }, async (ctx, req, params) => {
  const c = await prisma.contentEntry.findUnique({ where: { id: String(params.id) } });
  if (!c) throw notFound();
  const { status } = await parseJson(req, z.object({ status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"]) }));
  if (!NEXT[c.status]!.includes(status)) throw badRequest(`Can't move from ${c.status} to ${status}.`);
  const after = await prisma.$transaction(async (tx) => {
    if (status === "PUBLISHED") await tx.contentEntry.updateMany({ where: { section: c.section, key: c.key, locale: c.locale, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    return tx.contentEntry.update({ where: { id: c.id }, data: { status, publishedAt: status === "PUBLISHED" ? new Date() : c.publishedAt, updatedById: ctx.admin.id } });
  });
  await audit({ actor: ctx.actor, action: `content.${status.toLowerCase()}`, entityType: "ContentEntry", entityId: c.id, before: { status: c.status }, after: { status } });
  return after;
});
