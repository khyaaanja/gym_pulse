import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { recordManualMembershipPayment } from "@/services/payments/service";

const schema = z.object({
  memberId: z.string(),
  planId: z.string(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD_POS"]),
  amountRupees: z.number().min(0).max(1_000_000).optional(),
  note: z.string().max(300).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
  confirmDuplicate: z.boolean().optional(),
});

export const POST = gymRoute({ permission: "payments.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const payment = await recordManualMembershipPayment(ctx.gym, { memberId: b.memberId, planId: b.planId, method: b.method, amountPaisa: b.amountRupees !== undefined ? Math.round(b.amountRupees * 100) : undefined, note: b.note, idempotencyKey: b.idempotencyKey, confirmDuplicate: b.confirmDuplicate }, ctx.actor);
  return { paymentId: payment.id };
});
