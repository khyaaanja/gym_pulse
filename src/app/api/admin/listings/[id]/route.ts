import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const PATCH = adminRoute({ permission: "marketplace.manage" }, async (ctx, req, params) => {
  const p = await prisma.marketplaceProduct.findUnique({ where: { id: String(params.id) } });
  if (!p) throw notFound();
  const b = await parseJson(req, z.object({ decision: z.enum(["approve", "reject", "feature", "unfeature"]) }));
  const data = b.decision === "approve" ? { status: "ACTIVE" as const } : b.decision === "reject" ? { status: "ARCHIVED" as const } : { featured: b.decision === "feature" };
  const after = await prisma.marketplaceProduct.update({ where: { id: p.id }, data });
  await audit({ actor: ctx.actor, action: `marketplace.listing_${b.decision}`, entityType: "MarketplaceProduct", entityId: p.id, gymId: p.gymId, before: { status: p.status, featured: p.featured }, after: data });
  return after;
});
