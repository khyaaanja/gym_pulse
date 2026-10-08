import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { startOrderCheckout } from "@/services/payments/service";

export const POST = memberRoute({ feature: "payments" }, async (ctx, req, params) => {
  const { provider } = await parseJson(req, z.object({ provider: z.string().max(20) }));
  const { payment, instruction } = await startOrderCheckout(ctx.gym, ctx.member, String(params.id), provider);
  return { paymentId: payment.id, instruction };
});
