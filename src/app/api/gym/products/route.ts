import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/db/client";
import { assertOwnImage } from "@/services/files";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.string(),
  priceRupees: z.number().min(1).max(1_000_000),
  compareAtRupees: z.number().min(0).max(1_000_000).optional().nullable(),
  inventory: z.number().int().min(0).max(100_000).optional().nullable(),
  sessionCount: z.number().int().min(1).max(200).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(600).optional().nullable(),
  trainerId: z.string().optional().nullable(),
  featured: z.boolean().default(false),
  suggestAtStreak: z.number().int().min(1).max(365).optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  imageFileId: z.string().optional().nullable(),
});

export const GET = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx) =>
  ctx.db.marketplaceProduct.findMany({ include: { category: true, vendor: { select: { name: true } } }, orderBy: [{ status: "asc" }, { featured: "desc" }, { name: "asc" }] }),
);

export const POST = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const category = await prisma.marketplaceCategory.findFirst({ where: { id: b.categoryId, active: true } });
  if (!category) throw badRequest("Choose a category.");
  await assertOwnImage(ctx.gym.id, b.imageFileId, "PRODUCT_IMAGE");
  if (b.trainerId && !(await ctx.db.staffMember.findFirst({ where: { id: b.trainerId, role: "TRAINER", active: true } }))) throw badRequest("Choose a trainer from this gym.");
  const p = await ctx.db.marketplaceProduct.create({
    data: {
      gymId: ctx.gym.id, name: b.name, description: b.description, categoryId: category.id, kind: category.kind, pricePaisa: Math.round(b.priceRupees * 100),
      compareAtPaisa: b.compareAtRupees ? Math.round(b.compareAtRupees * 100) : null, inventory: category.kind === "PRODUCT" ? b.inventory ?? 0 : null,
      sessionCount: b.sessionCount, durationMinutes: b.durationMinutes, trainerId: b.trainerId, featured: b.featured, suggestAtStreak: b.suggestAtStreak, status: b.status, imageFileId: b.imageFileId,
    },
  });
  await audit({ actor: ctx.actor, action: "marketplace.product_created", entityType: "MarketplaceProduct", entityId: p.id, gymId: ctx.gym.id, after: p });
  return p;
});
