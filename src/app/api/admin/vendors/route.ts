import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const GET = adminRoute({ permission: "vendors.manage" }, async () =>
  prisma.marketplaceVendor.findMany({ include: { gyms: { include: { gym: { select: { id: true, name: true } } } }, _count: { select: { products: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
);

export const POST = adminRoute({ permission: "vendors.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), phone: z.string().max(20).nullable().optional(), contactName: z.string().max(80).nullable().optional(), description: z.string().max(500).nullable().optional(), panNumber: z.string().max(20).nullable().optional() }));
  const v = await prisma.marketplaceVendor.create({ data: b });
  await audit({ actor: ctx.actor, action: "vendors.created", entityType: "MarketplaceVendor", entityId: v.id, after: v });
  return v;
});
