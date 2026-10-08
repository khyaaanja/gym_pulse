import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

const schema = z.object({
  code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _.").transform((s) => s.toUpperCase()),
  description: z.string().max(200).optional().nullable(),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.number().positive(),
  appliesTo: z.enum(["MEMBERSHIP", "MARKETPLACE", "ALL"]).default("ALL"),
  maxRedemptions: z.number().int().min(1).optional().nullable(),
  perMemberLimit: z.number().int().min(1).max(100).default(1),
  validUntil: z.string().datetime().optional().nullable(),
});

// Coupons have a nullable gymId (platform coupons exist), so queries scope explicitly.
export const GET = gymRoute({ permission: "payments.manage" }, async (ctx) => prisma.coupon.findMany({ where: { gymId: ctx.gym.id }, orderBy: { createdAt: "desc" } }));

export const POST = gymRoute({ permission: "payments.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const value = b.kind === "PERCENT" ? Math.round(Math.min(b.value, 100) * 100) : Math.round(b.value * 100);
  const c = await prisma.coupon.create({ data: { gymId: ctx.gym.id, code: b.code, description: b.description, kind: b.kind, value, appliesTo: b.appliesTo, maxRedemptions: b.maxRedemptions, perMemberLimit: b.perMemberLimit, validUntil: b.validUntil ? new Date(b.validUntil) : null } });
  await audit({ actor: ctx.actor, action: "coupons.created", entityType: "Coupon", entityId: c.id, gymId: ctx.gym.id, after: c });
  return c;
});
