import { z } from "zod";
import { adminRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = adminRoute({ permission: "billing.view" }, async (_ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["ALL", "PENDING", "SUCCEEDED", "FAILED"]).default("ALL"), gymId: z.string().optional() }));
  const where = { ...(q.status === "ALL" ? {} : { status: q.status }), ...(q.gymId ? { gymId: q.gymId } : {}) };
  const [items, total, ledger] = await Promise.all([
    prisma.payment.findMany({ where, include: { gym: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.payment.count({ where }),
    prisma.ledgerEntry.groupBy({ by: ["account"], _sum: { amountPaisa: true } }),
  ]);
  // Member identity is not exposed in the platform finance view.
  return { ...paged(items.map((p) => ({ id: p.id, gym: p.gym.name, gymId: p.gymId, reference: p.reference, purpose: p.purpose, method: p.method, provider: p.provider, amountPaisa: p.amountPaisa, status: p.status, failureReason: p.failureReason, createdAt: p.createdAt, paidAt: p.paidAt })), total, q.page, q.pageSize), ledger };
});
