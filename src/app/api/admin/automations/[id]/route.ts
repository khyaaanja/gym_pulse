import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  conditions: z.object({ minDaysInactive: z.number().int().min(1).max(365).optional() }).optional(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 14).optional(),
  actionConfig: z.object({ template: z.string().max(40).optional(), channels: z.array(z.enum(["IN_APP", "SMS", "EMAIL", "WHATSAPP"])).max(4).optional(), roles: z.array(z.enum(["OWNER", "MANAGER", "STAFF", "TRAINER"])).optional() }).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

/** Every change bumps the rule version (runs are deduplicated per version). */
export const PATCH = adminRoute({ permission: "automations.manage" }, async (ctx, req, params) => {
  const before = await prisma.automationRule.findUnique({ where: { id: String(params.id) } });
  if (!before || before.gymId) throw notFound();
  const b = await parseJson(req, schema);
  const after = await prisma.automationRule.update({ where: { id: before.id }, data: { ...b, version: { increment: 1 }, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "automations.changed", entityType: "AutomationRule", entityId: before.id, before, after });
  return after;
});
