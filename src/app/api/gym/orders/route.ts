import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseQuery } from "@/lib/api";

export const GET = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["ALL", "PENDING_PAYMENT", "PAID", "FULFILLED", "CANCELLED"]).default("ALL"), q: z.string().max(40).optional() }));
  const where = { ...(q.status === "ALL" ? {} : { status: q.status }), ...(q.q ? { number: { contains: q.q, mode: "insensitive" as const } } : {}) };
  const [items, total] = await Promise.all([
    ctx.db.marketplaceOrder.findMany({ where, include: { member: { select: { fullName: true, memberCode: true } }, items: true }, orderBy: { placedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.marketplaceOrder.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});
