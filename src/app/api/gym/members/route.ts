import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertWithinLimit } from "@/lib/limits";
import { normalizeNepalPhone } from "@/lib/phone";
import { badRequest } from "@/lib/errors";
import { today as todayIn, isValidDateOnly } from "@/lib/time";
import { createInitialMembership } from "@/services/memberships";
import { assertContactFree, createMemberRecord } from "@/services/members";
import type { Prisma } from "@/generated/prisma/client";
import { memberScope } from "@/lib/scope";

const listSchema = paginationSchema.extend({
  q: z.string().max(100).optional(),
  status: z.enum(["ACTIVE", "ATTENTION", "AT_RISK", "LOST"]).optional(),
  sort: z.enum(["name", "risk", "lastVisit", "joined"]).default("name"),
});

export const GET = gymRoute({ permission: "members.view" }, async (ctx, req) => {
  const q = parseQuery(req, listSchema);
  const where: Prisma.MemberWhereInput = { archivedAt: null, ...memberScope(ctx) };
  if (q.status) where.riskStatus = q.status;
  if (q.q) {
    const digits = q.q.replace(/\D/g, "");
    where.OR = [{ fullName: { contains: q.q, mode: "insensitive" } }, { memberCode: { contains: q.q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
  }
  const orderBy: Prisma.MemberOrderByWithRelationInput =
    q.sort === "risk" ? { riskScore: { sort: "desc", nulls: "last" } } : q.sort === "lastVisit" ? { lastAttendanceAt: { sort: "asc", nulls: "first" } } : q.sort === "joined" ? { joinedOn: "desc" } : { fullName: "asc" };
  const [items, total] = await Promise.all([
    ctx.db.member.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, memberCode: true, fullName: true, phone: true, riskStatus: true, riskCategory: true, riskScore: true, lastAttendanceAt: true, currentStreak: true, joinedOn: true, memberships: { where: { status: "ACTIVE" }, orderBy: { endDate: "desc" }, take: 1, select: { endDate: true, plan: { select: { name: true } } } } },
    }),
    ctx.db.member.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the member's name.").max(100),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Enter a valid email.").optional().nullable().or(z.literal("")),
  memberCode: z.string().trim().max(40).optional().nullable(),
  planId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  trainerId: z.string().optional().nullable(),
});

export const POST = gymRoute({ permission: "members.edit" }, async (ctx, req) => {
  const body = await parseJson(req, createSchema);
  await assertWithinLimit(ctx.gym.id, "members", ctx.gym.timezone);
  const phone = body.phone ? normalizeNepalPhone(body.phone) : null;
  if (body.phone && !phone) throw badRequest("Enter a valid Nepal phone number (e.g. 98XXXXXXXX).");
  const today = todayIn(ctx.gym.timezone);
  const start = body.startDate && isValidDateOnly(body.startDate) ? body.startDate : today;
  const email = body.email || null;
  await assertContactFree(ctx.db, { phone, email });
  if (body.trainerId && !(await ctx.db.staffMember.findFirst({ where: { id: body.trainerId, role: "TRAINER" } }))) throw badRequest("Choose a trainer from this gym.");
  // Checked before the member is created, so a bad plan doesn't leave a member record behind.
  if (body.planId && !(await ctx.db.membershipPlan.findFirst({ where: { id: body.planId, active: true }, select: { id: true } }))) throw badRequest("Choose an active membership plan.");
  const member = await createMemberRecord(ctx.db, { gymId: ctx.gym.id, fullName: body.fullName, phone, email, memberCode: body.memberCode, joinedOn: start, trainerId: body.trainerId, source: "MANUAL" });
  if (body.planId) await createInitialMembership(ctx.db, member.id, body.planId, start);
  await audit({ actor: ctx.actor, action: "members.created", entityType: "Member", entityId: member.id, gymId: ctx.gym.id, after: { fullName: member.fullName, memberCode: member.memberCode, planId: body.planId } });
  return member;
});
