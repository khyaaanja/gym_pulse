import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const GET = adminRoute({ permission: "marketplace.manage" }, async () => prisma.coupon.findMany({ where: { gymId: null }, orderBy: { createdAt: "desc" } }));

export const POST = adminRoute({ permission: "marketplace.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ id: z.string().optional(), code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()), description: z.string().max(200).nullable().optional(), kind: z.enum(["PERCENT", "FIXED"]), value: z.number().positive(), maxRedemptions: z.number().int().min(1).nullable().optional(), validUntil: z.string().datetime().nullable().optional(), active: z.boolean().default(true) }));
  const value = b.kind === "PERCENT" ? Math.round(Math.min(b.value, 100) * 100) : Math.round(b.value * 100);
  const data = { code: b.code, description: b.description, kind: b.kind, value, appliesTo: "MARKETPLACE" as const, maxRedemptions: b.maxRedemptions, validUntil: b.validUntil ? new Date(b.validUntil) : null, active: b.active };
  const c = b.id ? await prisma.coupon.update({ where: { id: b.id, gymId: null }, data }) : await prisma.coupon.create({ data: { ...data, gymId: null } });
  await audit({ actor: ctx.actor, action: b.id ? "coupons.platform_updated" : "coupons.platform_created", entityType: "Coupon", entityId: c.id, after: data });
  return c;
});
