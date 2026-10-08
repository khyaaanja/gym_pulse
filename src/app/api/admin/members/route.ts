import { z } from "zod";
import { adminRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";

/** Privileged cross-gym member search. Every search is written to the audit log of each gym it touches. */
export const GET = adminRoute({ permission: "members.view" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ q: z.string().max(80).optional(), gymId: z.string().optional(), status: z.enum(["ALL", "ACTIVE", "AT_RISK", "EXPIRED", "SUSPENDED", "LOST"]).default("ALL") }));
  if (!q.q && !q.gymId) throw badRequest("Search by name, phone, email or membership ID, or pick a gym.");
  const where: Prisma.MemberWhereInput = { archivedAt: null };
  if (q.gymId) where.gymId = q.gymId;
  if (q.q) {
    const digits = q.q.replace(/\D/g, "");
    where.OR = [{ fullName: { contains: q.q, mode: "insensitive" } }, { memberCode: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
  }
  if (q.status === "AT_RISK" || q.status === "LOST") where.riskStatus = q.status;
  if (q.status === "ACTIVE") where.riskStatus = { in: ["ACTIVE", "ATTENTION"] };
  if (q.status === "SUSPENDED") where.status = "SUSPENDED";
  if (q.status === "EXPIRED") where.memberships = { none: { status: "ACTIVE" } };
  const [items, total] = await Promise.all([
    prisma.member.findMany({ where, include: { gym: { select: { id: true, name: true } } }, orderBy: { fullName: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.member.count({ where }),
  ]);
  for (const gymId of new Set(items.map((i) => i.gymId))) {
    await audit({ actor: ctx.actor, action: "platform.member_records_accessed", entityType: "Member", gymId, metadata: { query: q.q ?? null, results: items.filter((i) => i.gymId === gymId).length } });
  }
  return paged(items, total, q.page, q.pageSize);
});
