import { z } from "zod";
import { vendorRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { forbidden, badRequest } from "@/lib/errors";

const schema = z.object({
  gymId: z.string(),
  categoryId: z.string(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  priceRupees: z.number().min(1).max(1_000_000),
  inventory: z.number().int().min(0).max(100_000),
});

/** New vendor listings always start PENDING_APPROVAL; the gym (or GymPulse) must approve them. */
export const POST = vendorRoute({}, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const link = await prisma.vendorGym.findFirst({ where: { vendorId: ctx.vendor.id, gymId: b.gymId, active: true } });
  if (!link) throw forbidden("You aren't approved to sell at that gym.");
  const cat = await prisma.marketplaceCategory.findFirst({ where: { id: b.categoryId, active: true, kind: "PRODUCT" } });
  if (!cat) throw badRequest("Choose a product category.");
  const p = await prisma.marketplaceProduct.create({ data: { gymId: b.gymId, vendorId: ctx.vendor.id, categoryId: cat.id, kind: "PRODUCT", name: b.name, description: b.description, pricePaisa: Math.round(b.priceRupees * 100), inventory: b.inventory, status: "PENDING_APPROVAL" } });
  await audit({ actor: ctx.actor, action: "vendor.listing_submitted", entityType: "MarketplaceProduct", entityId: p.id, gymId: b.gymId, after: b });
  return p;
});
