import { gymRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = gymRoute({ permission: "audit.view" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema);
  const where = { gymId: ctx.gym.id };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});
