import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const GET = adminRoute({ permission: "content.manage" }, async () => prisma.contentEntry.findMany({ orderBy: [{ section: "asc" }, { key: "asc" }, { version: "desc" }] }));

/** Saves a new DRAFT version of a content block. */
export const POST = adminRoute({ permission: "content.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ section: z.enum(["WEBSITE", "APP", "MARKETPLACE", "LEGAL"]), key: z.string().regex(/^[a-z_]{2,40}$/), title: z.string().trim().min(2).max(80), locale: z.enum(["en", "ne"]).default("en"), data: z.record(z.string(), z.unknown()) }));
  const size = JSON.stringify(b.data).length;
  if (size > 100_000) throw new Error("Content too large");
  const latest = await prisma.contentEntry.findFirst({ where: { section: b.section, key: b.key, locale: b.locale }, orderBy: { version: "desc" } });
  const row = await prisma.contentEntry.create({ data: { ...b, data: b.data as never, status: "DRAFT", version: (latest?.version ?? 0) + 1, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "content.draft_saved", entityType: "ContentEntry", entityId: row.id, after: { section: b.section, key: b.key, version: row.version } });
  return row;
});
