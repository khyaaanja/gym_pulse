import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

const limit = z.number().int().min(0).nullable();
const schema = z.object({
  key: z.string().trim().regex(/^[a-z0-9-]{2,30}$/),
  name: z.string().trim().min(2).max(40),
  description: z.string().max(300).nullable().optional(),
  priceRupees: z.number().min(0).max(10_000_000),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
  memberLimit: limit, staffLimit: limit, storageLimitMb: limit, importsPerMonth: limit, predictionsPerMonth: limit, notificationsPerMonth: limit,
  highlights: z.array(z.string().max(80)).max(8).default([]),
  freeMonths: z.number().int().min(0).max(24).default(0),
  isPublic: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const GET = adminRoute({ permission: "billing.view" }, async () => prisma.saasPlan.findMany({ include: { _count: { select: { gyms: true } } }, orderBy: { sortOrder: "asc" } }));

export const POST = adminRoute({ permission: "plans.manage" }, async (ctx, req) => {
  const { priceRupees, ...b } = await parseJson(req, schema);
  const plan = await prisma.saasPlan.create({ data: { ...b, pricePaisa: Math.round(priceRupees * 100) } });
  await audit({ actor: ctx.actor, action: "plans.saas_created", entityType: "SaasPlan", entityId: plan.id, after: plan });
  return plan;
});
