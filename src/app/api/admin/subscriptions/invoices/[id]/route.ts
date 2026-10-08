import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { markInvoicePaid } from "@/services/billing";

export const POST = adminRoute({ permission: "billing.manage" }, async (ctx, req, params) => {
  const { paymentRef } = await parseJson(req, z.object({ paymentRef: z.string().trim().min(3, "Enter the bank/transfer reference.").max(100) }));
  return markInvoicePaid(String(params.id), paymentRef, ctx.actor);
});
