import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";

const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional().nullable(),
  durationDays: z.number().int().min(1).max(730),
  priceRupees: z.number().min(0).max(1_000_000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100).default(0),
});

export const GET = gymRoute({ permission: "members.view" }, async (ctx) => ctx.db.membershipPlan.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { durationDays: "asc" }] }));

export const POST = gymRoute({ permission: "plans.manage" }, async (ctx, req) => {
  const b = await parseJson(req, planSchema);
  const plan = await ctx.db.membershipPlan.create({ data: { gymId: ctx.gym.id, name: b.name, description: b.description, durationDays: b.durationDays, pricePaisa: Math.round(b.priceRupees * 100), active: b.active, sortOrder: b.sortOrder } });
  await audit({ actor: ctx.actor, action: "plans.created", entityType: "MembershipPlan", entityId: plan.id, gymId: ctx.gym.id, after: plan });
  return plan;
});
