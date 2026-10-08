import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = adminRoute({ permission: "payments.manage" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ status: z.enum(["ALL", "FAILED"]).default("ALL") }));
  return prisma.paymentWebhookEvent.findMany({
    where: q.status === "FAILED" ? { status: { in: ["REJECTED", "AMOUNT_MISMATCH", "UNKNOWN_PAYMENT", "ERROR"] } } : {},
    select: { id: true, provider: true, eventId: true, gymId: true, paymentId: true, signatureValid: true, status: true, error: true, receivedAt: true, processedAt: true, attempts: true },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
});
