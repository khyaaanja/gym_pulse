import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

const bps = z.number().int().min(0).max(10_000);
const commissionSchema = z.object({
  name: z.string().trim().min(2).max(60),
  scope: z.enum(["PLATFORM_DEFAULT", "CATEGORY", "VENDOR", "GYM", "PROMOTION"]),
  categoryId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  gymId: z.string().nullable().optional(),
  platformBps: bps, gymBps: bps, vendorBps: bps,
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
}).refine((r) => r.platformBps + r.gymBps + r.vendorBps === 10_000, { message: "Platform + gym + vendor shares must add up to 100%." });

export const GET = adminRoute({ permission: "marketplace.manage" }, async () => prisma.commissionRule.findMany({ orderBy: [{ scope: "asc" }, { priority: "desc" }] }));

export const POST = adminRoute({ permission: "marketplace.manage" }, async (ctx, req) => {
  const b = await parseJson(req, commissionSchema);
  if (b.scope === "CATEGORY" && !b.categoryId) throw badRequest("Choose a category.");
  if (b.scope === "VENDOR" && !b.vendorId) throw badRequest("Choose a vendor.");
  if (b.scope === "GYM" && !b.gymId) throw badRequest("Choose a gym.");
  const r = await prisma.commissionRule.create({ data: { ...b, validFrom: b.validFrom ? new Date(b.validFrom) : null, validUntil: b.validUntil ? new Date(b.validUntil) : null, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "commissions.created", entityType: "CommissionRule", entityId: r.id, after: r });
  return r;
});
