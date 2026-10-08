import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const GET = gymRoute({ permission: "members.view", feature: "streaks" }, async (ctx) => {
  const [challenges, milestones, rewards] = await Promise.all([
    ctx.db.challenge.findMany({ include: { reward: true, _count: { select: { progress: { where: { completedAt: { not: null } } } } } }, orderBy: { createdAt: "asc" } }),
    ctx.db.milestone.findMany({ include: { reward: true, _count: { select: { awarded: true } } }, orderBy: [{ kind: "asc" }, { threshold: "asc" }] }),
    ctx.db.reward.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  return { challenges, milestones, rewards };
});

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("challenge"), id: z.string().optional(), name: z.string().trim().min(2).max(60), description: z.string().max(200).optional().nullable(), kind: z.enum(["VISITS_IN_MONTH", "STREAK_DAYS", "WEEKEND_VISITS", "EARLY_BIRD"]), target: z.number().int().min(1).max(366), rewardId: z.string().nullable().optional(), active: z.boolean().default(true), beforeHour: z.number().int().min(3).max(12).optional() }),
  z.object({ type: z.literal("milestone"), id: z.string().optional(), name: z.string().trim().min(2).max(40), tier: z.string().trim().min(1).max(20), kind: z.enum(["STREAK", "TOTAL_VISITS"]), threshold: z.number().int().min(1).max(5000), rewardId: z.string().nullable().optional(), active: z.boolean().default(true) }),
  z.object({ type: z.literal("reward"), id: z.string().optional(), name: z.string().trim().min(2).max(60), description: z.string().max(200).optional().nullable(), kind: z.enum(["BADGE", "DISCOUNT", "FREE_SESSION", "MERCHANDISE"]), value: z.number().int().min(0).max(10000).default(0), active: z.boolean().default(true) }),
]);

export const POST = gymRoute({ permission: "settings.manage", feature: "streaks" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const gymId = ctx.gym.id;
  if ("rewardId" in b && b.rewardId && !(await ctx.db.reward.findUnique({ where: { id: b.rewardId } }))) throw badRequest("Choose one of your rewards.");
  let row;
  if (b.type === "challenge") {
    const data = { name: b.name, description: b.description, kind: b.kind, target: b.target, rewardId: b.rewardId ?? null, active: b.active, config: b.kind === "EARLY_BIRD" ? { beforeHour: b.beforeHour ?? 7 } : b.kind === "WEEKEND_VISITS" ? { weekendDays: [6] } : {} };
    row = b.id ? await ctx.db.challenge.update({ where: { id: b.id }, data }) : await ctx.db.challenge.create({ data: { ...data, gymId } });
  } else if (b.type === "milestone") {
    const data = { name: b.name, tier: b.tier, kind: b.kind, threshold: b.threshold, rewardId: b.rewardId ?? null, active: b.active };
    row = b.id ? await ctx.db.milestone.update({ where: { id: b.id }, data }) : await ctx.db.milestone.create({ data: { ...data, gymId } });
  } else {
    const data = { name: b.name, description: b.description, kind: b.kind, value: b.value, active: b.active };
    row = b.id ? await ctx.db.reward.update({ where: { id: b.id }, data }) : await ctx.db.reward.create({ data: { ...data, gymId } });
  }
  await audit({ actor: ctx.actor, action: `engagement.${b.type}_${b.id ? "updated" : "created"}`, entityType: b.type, entityId: row.id, gymId, after: b });
  return row;
});
