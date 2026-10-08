import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  durationDays: z.number().int().min(1).max(730).optional(),
  priceRupees: z.number().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

/** Price changes apply to future purchases only; existing memberships keep their price. Audited. */
export const PATCH = gymRoute({ permission: "plans.manage" }, async (ctx, req, params) => {
  const before = await ctx.db.membershipPlan.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound();
  const { priceRupees, ...rest } = await parseJson(req, schema);
  const after = await ctx.db.membershipPlan.update({ where: { id: before.id }, data: { ...rest, ...(priceRupees !== undefined ? { pricePaisa: Math.round(priceRupees * 100) } : {}) } });
  await audit({ actor: ctx.actor, action: priceRupees !== undefined && after.pricePaisa !== before.pricePaisa ? "plans.price_changed" : "plans.updated", entityType: "MembershipPlan", entityId: before.id, gymId: ctx.gym.id, before, after });
  return after;
});
