import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";

export const PATCH = gymRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const { step, done } = await parseJson(req, z.object({ step: z.number().int().min(1).max(10), done: z.boolean().optional() }));
  return prisma.gym.update({ where: { id: ctx.gym.id }, data: { onboardingStep: Math.max(step, ctx.gym.onboardingStep), ...(done ? { onboardedAt: new Date() } : {}) } });
});
