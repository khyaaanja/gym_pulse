import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { applyCoupon } from "@/services/coupons";
import { rateLimit } from "@/lib/rate-limit";

export const POST = memberRoute({}, async (ctx, req) => {
  const b = await parseJson(req, z.object({ code: z.string().trim().min(2).max(40), scope: z.enum(["MEMBERSHIP", "MARKETPLACE"]), amountPaisa: z.number().int().min(0) }));
  await rateLimit(`coupon:${ctx.member.id}`, 20, 900);
  const r = await applyCoupon(ctx.gym.id, ctx.member.id, b.code, b.scope, b.amountPaisa);
  return { code: r.code, discountPaisa: r.discountPaisa };
});
