import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { promotionData, promotionSchema } from "../shared";

async function own(ctx: Parameters<typeof promotionData>[0], id: string) {
  const p = await ctx.db.gymPromotion.findUnique({ where: { id } });
  if (!p) throw notFound("Offer not found.");
  return p;
}

export const PATCH = gymRoute({ permission: "promotions.manage" }, async (ctx, req, params) => {
  const before = await own(ctx, String(params.id));
  const b = await parseJson(req, promotionSchema.partial());
  // An edit that sends only one date is still checked against the stored other one.
  const data = await promotionData(ctx, b);
  const startsAt = data.startsAt !== undefined ? data.startsAt : before.startsAt;
  const endsAt = data.endsAt !== undefined ? data.endsAt : before.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) throw badRequest("The offer must end after it starts.");
  const after = await ctx.db.gymPromotion.update({ where: { id: before.id }, data });
  await audit({ actor: ctx.actor, action: "promotions.updated", entityType: "GymPromotion", entityId: before.id, gymId: ctx.gym.id, before, after });
  return after;
});

export const DELETE = gymRoute({ permission: "promotions.manage" }, async (ctx, _req, params) => {
  const before = await own(ctx, String(params.id));
  await ctx.db.gymPromotion.delete({ where: { id: before.id } });
  await audit({ actor: ctx.actor, action: "promotions.deleted", entityType: "GymPromotion", entityId: before.id, gymId: ctx.gym.id, before });
  return { ok: true };
});
