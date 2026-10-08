import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { startMembershipCheckout } from "@/services/payments/service";

export const POST = memberRoute({ feature: "payments" }, async (ctx, req) => {
  const body = await parseJson(req, z.object({ planId: z.string(), provider: z.string().max(20), couponCode: z.string().max(40).optional().nullable() }));
  const { payment, instruction } = await startMembershipCheckout(ctx.gym, ctx.member, body);
  return { paymentId: payment.id, reference: payment.reference, instruction };
});
