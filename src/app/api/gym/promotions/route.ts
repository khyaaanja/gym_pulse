import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { promotionSchema, promotionData } from "./shared";

export const GET = gymRoute({ permission: "promotions.manage" }, async (ctx) =>
  ctx.db.gymPromotion.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }], include: { coupon: { select: { code: true } }, plan: { select: { name: true } } } }),
);

export const POST = gymRoute({ permission: "promotions.manage" }, async (ctx, req) => {
  const b = await parseJson(req, promotionSchema);
  const row = await ctx.db.gymPromotion.create({ data: { gymId: ctx.gym.id, ...(await promotionData(ctx, b)), title: b.title, createdById: ctx.staff.id } });
  await audit({ actor: ctx.actor, action: "promotions.created", entityType: "GymPromotion", entityId: row.id, gymId: ctx.gym.id, after: row });
  return row;
});
