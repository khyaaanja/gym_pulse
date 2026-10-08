import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";

export const GET = adminRoute({ permission: "marketplace.manage" }, async () => prisma.marketplaceCategory.findMany({ include: { _count: { select: { products: true } } }, orderBy: { sortOrder: "asc" } }));

export const POST = adminRoute({ permission: "marketplace.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(40), kind: z.enum(["PRODUCT", "SERVICE"]), active: z.boolean().default(true), sortOrder: z.number().int().default(0) }));
  const row = b.id
    ? await prisma.marketplaceCategory.update({ where: { id: b.id }, data: { name: b.name, active: b.active, sortOrder: b.sortOrder } })
    : await prisma.marketplaceCategory.create({ data: { name: b.name, slug: slugify(b.name), kind: b.kind, active: b.active, sortOrder: b.sortOrder } });
  await audit({ actor: ctx.actor, action: b.id ? "marketplace.category_updated" : "marketplace.category_created", entityType: "MarketplaceCategory", entityId: row.id, after: b });
  return row;
});
