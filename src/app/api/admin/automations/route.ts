import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

const automationSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().trim().min(3).max(100),
  trigger: z.enum(["MEMBER_INACTIVE", "MEMBERSHIP_EXPIRING", "MEMBERSHIP_EXPIRED", "PAYMENT_FAILED", "MILESTONE_REACHED", "MARKETPLACE_PURCHASE"]),
  conditions: z.object({ minDaysInactive: z.number().int().min(1).max(365).optional() }).default({}),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 14).default(0),
  action: z.enum(["FLAG_AT_RISK", "SEND_NOTIFICATION", "NOTIFY_STAFF", "AWARD_REWARD", "CREATE_BOOKING"]),
  actionConfig: z.object({ template: z.string().max(40).optional(), channels: z.array(z.enum(["IN_APP", "SMS", "EMAIL", "WHATSAPP"])).max(4).optional(), roles: z.array(z.enum(["OWNER", "MANAGER", "STAFF", "TRAINER"])).optional() }).default({}),
  audience: z.enum(["MEMBER", "STAFF", "OWNER"]),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
});

export const GET = adminRoute({ permission: "automations.manage" }, async () => prisma.automationRule.findMany({ where: { gymId: null }, orderBy: [{ trigger: "asc" }, { priority: "desc" }] }));

export const POST = adminRoute({ permission: "automations.manage" }, async (ctx, req) => {
  const b = await parseJson(req, automationSchema);
  const r = await prisma.automationRule.create({ data: { ...b, gymId: null, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "automations.created", entityType: "AutomationRule", entityId: r.id, after: r });
  return r;
});
