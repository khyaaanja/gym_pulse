import { z } from "zod";
import { vendorRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceRupees: z.number().min(1).max(1_000_000).optional(),
  inventory: z.number().int().min(0).max(100_000).optional(),
  archived: z.boolean().optional(),
});

/** Stock updates apply immediately; changes to what's being sold (name/description/price) need re-approval. */
export const PATCH = vendorRoute({}, async (ctx, req, params) => {
  const p = await prisma.marketplaceProduct.findFirst({ where: { id: String(params.id), vendorId: ctx.vendor.id } });
  if (!p) throw notFound();
  const b = await parseJson(req, schema);
  const substantive = b.name !== undefined || b.description !== undefined || b.priceRupees !== undefined;
  const after = await prisma.marketplaceProduct.update({
    where: { id: p.id },
    data: {
      name: b.name, description: b.description, inventory: b.inventory,
      ...(b.priceRupees ? { pricePaisa: Math.round(b.priceRupees * 100) } : {}),
      ...(b.archived ? { status: "ARCHIVED" } : substantive ? { status: "PENDING_APPROVAL" } : {}),
    },
  });
  await audit({ actor: ctx.actor, action: "vendor.listing_updated", entityType: "MarketplaceProduct", entityId: p.id, gymId: p.gymId, before: p, after: b });
  return after;
});
