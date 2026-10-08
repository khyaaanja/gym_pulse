import { gymRoute, parseJson, type GymContext } from "@/lib/api";
import { audit } from "@/lib/audit";
import { forbidden, notFound } from "@/lib/errors";
import { canSeeMember } from "@/lib/scope";
import { dietPlanPatchSchema } from "@/services/diet";

async function own(ctx: GymContext, id: string) {
  const plan = await ctx.db.dietPlan.findUnique({ where: { id }, include: { member: { select: { trainerId: true } } } });
  if (!plan) throw notFound("Diet plan not found.");
  if (plan.member && !canSeeMember(ctx, plan.member)) throw forbidden("You can only change plans of members assigned to you.");
  // Templates are shared by the whole gym: a trainer may change only the ones they wrote.
  if (plan.isTemplate && ctx.staff.role === "TRAINER" && plan.createdById !== ctx.staff.id) throw forbidden("Only the trainer who wrote this template, or a manager, can change it.");
  return plan;
}

export const PATCH = gymRoute({ permission: "diet.manage" }, async (ctx, req, params) => {
  const before = await own(ctx, String(params.id));
  const b = await parseJson(req, dietPlanPatchSchema);
  const after = await ctx.db.dietPlan.update({ where: { id: before.id }, data: b });
  await audit({ actor: ctx.actor, action: "diet.updated", entityType: "DietPlan", entityId: before.id, gymId: ctx.gym.id, before: { title: before.title, memberId: before.memberId, goal: before.goal, dailyCalories: before.dailyCalories }, after: b });
  return after;
});

/** Templates are deleted; a member's plan is ended (kept as history) so they and staff can still see what was given. */
export const DELETE = gymRoute({ permission: "diet.manage" }, async (ctx, _req, params) => {
  const before = await own(ctx, String(params.id));
  if (before.isTemplate) await ctx.db.dietPlan.delete({ where: { id: before.id } });
  else await ctx.db.dietPlan.update({ where: { id: before.id }, data: { active: false } });
  await audit({ actor: ctx.actor, action: before.isTemplate ? "diet.template_deleted" : "diet.ended", entityType: "DietPlan", entityId: before.id, gymId: ctx.gym.id, before: { title: before.title, memberId: before.memberId } });
  return { ok: true };
});
