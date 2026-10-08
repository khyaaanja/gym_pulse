import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

export const GET = adminRoute({ permission: "marketplace.manage" }, async () => prisma.promotion.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }] }));

export const POST = adminRoute({ permission: "marketplace.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ id: z.string().optional(), title: z.string().trim().min(2).max(80), subtitle: z.string().max(160).nullable().optional(), gymId: z.string().nullable().optional(), productId: z.string().nullable().optional(), couponId: z.string().nullable().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), active: z.boolean().default(true), sortOrder: z.number().int().default(0) }));
  const data = { ...b, id: undefined, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null };
  const row = b.id ? await prisma.promotion.update({ where: { id: b.id }, data }) : await prisma.promotion.create({ data });
  await audit({ actor: ctx.actor, action: b.id ? "promotions.updated" : "promotions.created", entityType: "Promotion", entityId: row.id, after: b });
  return row;
});
