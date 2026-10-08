import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { effectiveRules } from "@/services/automation";

export const GET = gymRoute({ permission: "settings.manage", feature: "automation" }, async (ctx) => effectiveRules(ctx.gym.id));

/**
 * Gyms tune the platform's rules; they can't invent new actions. An override copies the platform
 * rule's trigger, action and audience, and keeps its version so tuning a rule never re-sends
 * messages that already went out.
 */
const schema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("override"),
    key: z.string().min(1).max(60),
    enabled: z.boolean(),
    delayMinutes: z.number().int().min(0).max(60 * 24 * 14),
    minDaysInactive: z.number().int().min(1).max(365).nullable().optional(),
    channels: z.array(z.enum(["IN_APP", "SMS", "EMAIL", "WHATSAPP"])).min(1).max(4),
  }),
  z.object({ op: z.literal("reset"), key: z.string().min(1).max(60) }),
]);

export const PUT = gymRoute({ permission: "settings.manage", feature: "automation" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const base = await prisma.automationRule.findFirst({ where: { gymId: null, key: b.key } });
  if (!base) throw badRequest("That automation doesn't exist.");
  const before = await prisma.automationRule.findFirst({ where: { gymId: ctx.gym.id, key: b.key } });
  if (b.op === "reset") {
    if (before) await prisma.automationRule.delete({ where: { id: before.id } });
    await audit({ actor: ctx.actor, action: "automations.gym_reset", entityType: "AutomationRule", entityId: base.id, gymId: ctx.gym.id, before });
    return { reset: true };
  }
  if ((b.channels.includes("SMS") && !ctx.flags.sms) || (b.channels.includes("WHATSAPP") && !ctx.flags.whatsapp)) throw badRequest("That channel isn't available on your plan.");
  const baseConfig = (base.actionConfig ?? {}) as Prisma.JsonObject;
  const baseConditions = (base.conditions ?? {}) as Prisma.JsonObject;
  const data = {
    name: base.name, trigger: base.trigger, action: base.action, audience: base.audience, priority: base.priority, version: base.version,
    enabled: b.enabled, delayMinutes: b.delayMinutes, updatedById: ctx.user.id,
    conditions: base.trigger === "MEMBER_INACTIVE" && b.minDaysInactive ? { ...baseConditions, minDaysInactive: b.minDaysInactive } : baseConditions,
    actionConfig: { ...baseConfig, channels: b.channels },
  };
  const after = before
    ? await prisma.automationRule.update({ where: { id: before.id }, data })
    : await prisma.automationRule.create({ data: { ...data, gymId: ctx.gym.id, key: base.key } });
  await audit({ actor: ctx.actor, action: "automations.gym_override", entityType: "AutomationRule", entityId: after.id, gymId: ctx.gym.id, before, after });
  return after;
});
