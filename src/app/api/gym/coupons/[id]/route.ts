import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const PATCH = gymRoute({ permission: "payments.manage" }, async (ctx, req, params) => {
  const c = await prisma.coupon.findFirst({ where: { id: String(params.id), gymId: ctx.gym.id } });
  if (!c) throw notFound();
  const b = await parseJson(req, z.object({ active: z.boolean() }));
  const after = await prisma.coupon.update({ where: { id: c.id }, data: { active: b.active } });
  await audit({ actor: ctx.actor, action: "coupons.updated", entityType: "Coupon", entityId: c.id, gymId: ctx.gym.id, before: { active: c.active }, after: b });
  return after;
});
