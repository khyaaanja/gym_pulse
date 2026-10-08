import { z } from "zod";
import { adminRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";
import type { Prisma } from "@/generated/prisma/client";

export const GET = adminRoute({ permission: "audit.view" }, async (_ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ gymId: z.string().optional(), action: z.string().max(60).optional(), actorType: z.enum(["PLATFORM_ADMIN", "USER", "SYSTEM", "DEVICE"]).optional() }));
  const where: Prisma.AuditLogWhereInput = { ...(q.gymId ? { gymId: q.gymId } : {}), ...(q.action ? { action: { contains: q.action } } : {}), ...(q.actorType ? { actorType: q.actorType } : {}) };
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), prisma.auditLog.count({ where })]);
  return paged(items, total, q.page, q.pageSize);
});
