import { z } from "zod";
import { gymRoute, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { forbidden, notFound } from "@/lib/errors";
import { canSeeMember, memberScope } from "@/lib/scope";
import { assignDietPlan, dietPlanSchema } from "@/services/diet";
import { notify } from "@/services/notifications";

export const GET = gymRoute({ permission: "diet.manage" }, async (ctx, req) => {
  const q = parseQuery(req, z.object({ memberId: z.string().max(40).optional() }));
  const [templates, assigned] = await Promise.all([
    ctx.db.dietPlan.findMany({ where: { isTemplate: true }, orderBy: { title: "asc" } }),
    ctx.db.dietPlan.findMany({
      // Trainers only ever see plans of the members assigned to them.
      where: { isTemplate: false, active: true, ...(q.memberId ? { memberId: q.memberId } : {}), member: { archivedAt: null, ...memberScope(ctx) } },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { member: { select: { id: true, fullName: true, memberCode: true } } },
    }),
  ]);
  return { templates, assigned };
});

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), plan: dietPlanSchema }),
  z.object({ kind: z.literal("assign"), memberId: z.string().max(40), templateId: z.string().max(40).nullable().optional(), plan: dietPlanSchema.nullable().optional() }),
]);

/** Save a reusable template, or give a member a plan (from a template or written for them). */
export const POST = gymRoute({ permission: "diet.manage" }, async (ctx, req) => {
  const b = await parseJson(req, body);
  if (b.kind === "template") {
    const t = await ctx.db.dietPlan.create({ data: { ...b.plan, gymId: ctx.gym.id, isTemplate: true, createdById: ctx.staff.id } });
    await audit({ actor: ctx.actor, action: "diet.template_created", entityType: "DietPlan", entityId: t.id, gymId: ctx.gym.id, after: { title: t.title } });
    return t;
  }
  const member = await ctx.db.member.findFirst({ where: { id: b.memberId, archivedAt: null }, select: { id: true, trainerId: true, fullName: true } });
  if (!member) throw notFound("Member not found.");
  if (!canSeeMember(ctx, member)) throw forbidden("You can only give plans to members assigned to you.");
  const plan = await assignDietPlan(ctx.db, ctx.gym.id, member.id, { templateId: b.templateId, plan: b.plan }, ctx.staff.id);
  await notify({ gymId: ctx.gym.id, memberId: member.id, channel: "IN_APP", category: "DIET", title: "Your new diet plan is ready", body: `${ctx.user.name} gave you "${plan.title}". Open it to see your meals and daily targets.`, link: "/app/diet" });
  await audit({ actor: ctx.actor, action: "diet.assigned", entityType: "DietPlan", entityId: plan.id, gymId: ctx.gym.id, after: { memberId: member.id, title: plan.title, templateId: b.templateId ?? null } });
  return plan;
});
