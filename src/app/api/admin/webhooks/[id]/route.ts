import { adminRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { reverifyPayment } from "@/services/payments/service";

/** "Retry" re-verifies the payment with the provider's status API — it never replays an unverified body. */
export const POST = adminRoute({ permission: "payments.manage" }, async (ctx, _req, params) => {
  const evt = await prisma.paymentWebhookEvent.findUnique({ where: { id: String(params.id) } });
  if (!evt) throw notFound();
  if (!evt.paymentId) throw badRequest("This event isn't linked to a payment, so there's nothing to re-verify.");
  const res = await reverifyPayment(evt.paymentId);
  await audit({ actor: ctx.actor, action: "payments.webhook_retried", entityType: "PaymentWebhookEvent", entityId: evt.id, gymId: evt.gymId, after: { result: res.status } });
  return res;
});
