import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseJson, parseQuery } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { ensureRecoveryTask } from "@/services/recovery";
import { audit } from "@/lib/audit";
import { activeMembership, membershipMonthlyFee } from "@/services/memberships";
import { today as todayIn } from "@/lib/time";

export const GET = gymRoute({ permission: "recovery.manage" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN") }));
  const where = q.status === "OPEN" ? { closedAt: null } : q.status === "CLOSED" ? { closedAt: { not: null } } : {};
  const [items, total] = await Promise.all([
    ctx.db.recoveryTask.findMany({ where, include: { member: { select: { id: true, fullName: true, phone: true, riskCategory: true, lastAttendanceAt: true } } }, orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.recoveryTask.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});

/** "Start Recovery" from Pulse or a prediction report. */
export const POST = gymRoute({ permission: "recovery.manage" }, async (ctx, req) => {
  const { memberId, reason } = await parseJson(req, z.object({ memberId: z.string(), reason: z.string().max(200).optional() }));
  const member = await ctx.db.member.findUnique({ where: { id: memberId } });
  if (!member) throw notFound("Member not found.");
  if (member.archivedAt) throw badRequest("This member is archived.");
  const ms = await activeMembership(ctx.db, member.id, todayIn(ctx.gym.timezone));
  const assessment = await ctx.db.riskAssessment.findFirst({ where: { memberId }, orderBy: { assessedAt: "desc" } });
  const { task, created } = await ensureRecoveryTask(ctx.gym.id, member.id, {
    reason: reason ?? (assessment ? (assessment.factors as { detail: string }[])[0]?.detail ?? "Needs follow-up" : "Needs follow-up"),
    monthlyFeePaisa: ms ? membershipMonthlyFee(ms) : 0,
    riskAssessmentId: assessment?.id,
    createdById: ctx.user.id,
    assignedToId: ctx.staff.id,
  });
  if (created) await audit({ actor: ctx.actor, action: "recovery.started", entityType: "RecoveryTask", entityId: task.id, gymId: ctx.gym.id });
  return { task, created };
});
