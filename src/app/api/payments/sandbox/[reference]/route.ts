import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { forbidden, notFound } from "@/lib/errors";
import { handleWebhook } from "@/services/payments/service";
import { signSandboxWebhook, testGatewayEnabled } from "@/services/payments/providers";

/**
 * Test gateway (non-production only). Simulates the provider: it builds a signed webhook and
 * sends it through exactly the same verification path a real provider webhook takes.
 */
export const POST = memberRoute({}, async (ctx, req, params) => {
  if (!testGatewayEnabled()) throw forbidden("The test gateway is disabled.");
  const { decision } = await parseJson(req, z.object({ decision: z.enum(["approve", "decline"]) }));
  const payment = await ctx.db.payment.findFirst({ where: { reference: String(params.reference), memberId: ctx.member.id, provider: "sandbox" } });
  if (!payment) throw notFound("Payment not found.");
  const body = JSON.stringify({ id: `sbx_${crypto.randomUUID()}`, reference: payment.reference, status: decision === "approve" ? "SUCCEEDED" : "FAILED", amountPaisa: payment.amountPaisa });
  const headers = new Headers({ "x-gympulse-signature": signSandboxWebhook(body) });
  const res = await handleWebhook("sandbox", body, headers);
  return { status: res.status, paymentId: payment.id, redirect: decision === "approve" ? `/app/receipts/${payment.id}` : "/app/renew?payment=failed" };
});
