import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { assertOwnImage } from "@/services/files";

const schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceRupees: z.number().min(1).max(1_000_000).optional(),
  inventory: z.number().int().min(0).max(100_000).nullable().optional(),
  featured: z.boolean().optional(),
  suggestAtStreak: z.number().int().min(1).max(365).nullable().optional(),
  // Gyms approve vendor listings by activating them.
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  imageFileId: z.string().nullable().optional(),
});

export const PATCH = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx, req, params) => {
  const before = await ctx.db.marketplaceProduct.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound();
  const { priceRupees, ...rest } = await parseJson(req, schema);
  await assertOwnImage(ctx.gym.id, rest.imageFileId, "PRODUCT_IMAGE");
  if (before.isBundle) {
    // A bundle's stock comes from its items, and its price has to stay below buying them separately.
    if (rest.inventory !== undefined && rest.inventory !== null) throw badRequest("A bundle's stock comes from its items — update the items' stock instead.");
    delete rest.inventory;
    if (priceRupees && before.compareAtPaisa !== null && Math.round(priceRupees * 100) >= before.compareAtPaisa) throw badRequest("A bundle must cost less than buying its items separately.");
  }
  const after = await ctx.db.marketplaceProduct.update({ where: { id: before.id }, data: { ...rest, ...(priceRupees ? { pricePaisa: Math.round(priceRupees * 100) } : {}) } });
  const action = before.status === "PENDING_APPROVAL" && after.status === "ACTIVE" ? "marketplace.vendor_listing_approved" : "marketplace.product_updated";
  await audit({ actor: ctx.actor, action, entityType: "MarketplaceProduct", entityId: before.id, gymId: ctx.gym.id, before, after });
  return after;
});
