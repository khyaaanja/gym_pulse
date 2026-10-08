import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createBundle } from "@/services/marketplace";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.string(),
  priceRupees: z.number().min(1).max(1_000_000),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10) })).min(2).max(8),
  featured: z.boolean().default(false),
  status: z.enum(["DRAFT", "ACTIVE"]).default("ACTIVE"),
});

export const POST = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const bundle = await createBundle(ctx.gym.id, { ...b, pricePaisa: Math.round(b.priceRupees * 100) });
  await audit({ actor: ctx.actor, action: "marketplace.bundle_created", entityType: "MarketplaceProduct", entityId: bundle.id, gymId: ctx.gym.id, after: { ...bundle, items: b.items } });
  return bundle;
});
