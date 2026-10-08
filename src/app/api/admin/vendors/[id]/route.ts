import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const PATCH = adminRoute({ permission: "vendors.manage" }, async (ctx, req, params) => {
  const v = await prisma.marketplaceVendor.findUnique({ where: { id: String(params.id) } });
  if (!v) throw notFound();
  const b = await parseJson(req, z.object({ status: z.enum(["PENDING", "APPROVED", "SUSPENDED", "REJECTED"]).optional(), linkGymId: z.string().optional(), unlinkGymId: z.string().optional() }));
  if (b.status) {
    await prisma.marketplaceVendor.update({ where: { id: v.id }, data: { status: b.status, reviewedById: ctx.admin.id, reviewedAt: new Date() } });
    // A suspended vendor's listings come off sale immediately.
    if (b.status === "SUSPENDED" || b.status === "REJECTED") await prisma.marketplaceProduct.updateMany({ where: { vendorId: v.id, status: "ACTIVE" }, data: { status: "PENDING_APPROVAL" } });
  }
  if (b.linkGymId) await prisma.vendorGym.upsert({ where: { gymId_vendorId: { gymId: b.linkGymId, vendorId: v.id } }, create: { gymId: b.linkGymId, vendorId: v.id }, update: { active: true } });
  if (b.unlinkGymId) await prisma.vendorGym.updateMany({ where: { gymId: b.unlinkGymId, vendorId: v.id }, data: { active: false } });
  await audit({ actor: ctx.actor, action: b.status ? `vendors.${b.status.toLowerCase()}` : "vendors.gyms_changed", entityType: "MarketplaceVendor", entityId: v.id, before: { status: v.status }, after: b });
  return prisma.marketplaceVendor.findUnique({ where: { id: v.id } });
});
