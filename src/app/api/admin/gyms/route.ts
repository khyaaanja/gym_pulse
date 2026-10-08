import { z } from "zod";
import { adminRoute, paged, paginationSchema, parseJson, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";
import { passwordSchema } from "@/lib/auth/password";
import { createGymWithOwner } from "@/services/gyms";

export const GET = adminRoute({ permission: "gyms.view" }, async (_ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["ALL", "TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]).default("ALL"), q: z.string().max(80).optional() }));
  const where = { ...(q.status === "ALL" ? {} : { status: q.status }), ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" as const } }, { city: { contains: q.q, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.gym.findMany({ where, include: { plan: { select: { name: true } }, _count: { select: { members: { where: { archivedAt: null } } } }, staff: { where: { role: "OWNER" }, include: { user: { select: { name: true, email: true } } }, take: 1 } }, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.gym.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});

export const POST = adminRoute({ permission: "gyms.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ gymName: z.string().trim().min(2).max(80), city: z.string().max(60).optional(), ownerName: z.string().trim().min(2).max(80), email: z.string().email(), phone: z.string().max(20).optional().nullable(), password: passwordSchema }));
  const { gym } = await createGymWithOwner(b, ctx.actor);
  await prisma.user.update({ where: { email: b.email.toLowerCase() }, data: { mustResetPassword: true } });
  return gym;
});
