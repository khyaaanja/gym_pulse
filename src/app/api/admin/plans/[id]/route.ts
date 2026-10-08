import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

const limit = z.number().int().min(0).nullable().optional();
const schema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  description: z.string().max(300).nullable().optional(),
  priceRupees: z.number().min(0).max(10_000_000).optional(),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  memberLimit: limit, staffLimit: limit, storageLimitMb: limit, importsPerMonth: limit, predictionsPerMonth: limit, notificationsPerMonth: limit,
  highlights: z.array(z.string().max(80)).max(8).optional(),
  freeMonths: z.number().int().min(0).max(24).optional(),
  isPublic: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = adminRoute({ permission: "plans.manage" }, async (ctx, req, params) => {
  const before = await prisma.saasPlan.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound();
  const { priceRupees, ...b } = await parseJson(req, schema);
  const after = await prisma.saasPlan.update({ where: { id: before.id }, data: { ...b, ...(priceRupees !== undefined ? { pricePaisa: Math.round(priceRupees * 100) } : {}) } });
  await audit({ actor: ctx.actor, action: "plans.saas_updated", entityType: "SaasPlan", entityId: before.id, before, after });
  return after;
});
