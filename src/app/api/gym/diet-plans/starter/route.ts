import { gymRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { STARTER_TEMPLATES } from "@/services/diet";

/** Adds the ready-made templates this gym doesn't have yet (matched by title), so running it twice adds nothing. */
export const POST = gymRoute({ permission: "diet.manage" }, async (ctx) => {
  const have = new Set((await ctx.db.dietPlan.findMany({ where: { isTemplate: true }, select: { title: true } })).map((t) => t.title));
  const add = STARTER_TEMPLATES.filter((t) => !have.has(t.title));
  if (add.length) await ctx.db.dietPlan.createMany({ data: add.map((t) => ({ ...t, gymId: ctx.gym.id, isTemplate: true, createdById: ctx.staff.id })) });
  await audit({ actor: ctx.actor, action: "diet.starter_templates_added", entityType: "DietPlan", entityId: null, gymId: ctx.gym.id, after: { added: add.map((t) => t.title) } });
  return { added: add.length };
});
