import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseQuery } from "@/lib/api";

export const GET = gymRoute({ permission: "payments.view" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["ALL", "PENDING", "SUCCEEDED", "FAILED"]).default("ALL"), q: z.string().max(60).optional() }));
  const where = { ...(q.status === "ALL" ? {} : { status: q.status }), ...(q.q ? { reference: { contains: q.q, mode: "insensitive" as const } } : {}) };
  const [items, total] = await Promise.all([
    ctx.db.payment.findMany({ where, include: { member: { select: { id: true, fullName: true, memberCode: true } }, invoice: { select: { number: true } } }, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.payment.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});
