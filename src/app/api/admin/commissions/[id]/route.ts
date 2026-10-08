import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

export const PATCH = adminRoute({ permission: "marketplace.manage" }, async (ctx, req, params) => {
  const before = await prisma.commissionRule.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound();
  const b = await parseJson(req, z.object({ active: z.boolean().optional(), priority: z.number().int().optional(), platformBps: z.number().int().min(0).max(10000).optional(), gymBps: z.number().int().min(0).max(10000).optional(), vendorBps: z.number().int().min(0).max(10000).optional() }));
  const merged = { ...before, ...b };
  if (merged.platformBps + merged.gymBps + merged.vendorBps !== 10_000) throw badRequest("Shares must add up to 100%.");
  const after = await prisma.commissionRule.update({ where: { id: before.id }, data: { ...b, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "commissions.changed", entityType: "CommissionRule", entityId: before.id, before, after });
  return after;
});
