import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { normalizeNepalPhone } from "@/lib/phone";
import { badRequest, notFound } from "@/lib/errors";
import { assertContactFree } from "@/services/members";
import { canSeeMember } from "@/lib/scope";

async function load(ctx: Parameters<Parameters<typeof gymRoute>[1]>[0], id: string) {
  const member = await ctx.db.member.findUnique({ where: { id } });
  if (!member || !canSeeMember(ctx, member)) throw notFound("Member not found.");
  return member;
}

export const GET = gymRoute({ permission: "members.view" }, async (ctx, _req, params) => {
  const member = await load(ctx, String(params.id));
  const [memberships, attendance, tasks, assessment, history] = await Promise.all([
    ctx.db.membership.findMany({ where: { memberId: member.id }, include: { plan: true }, orderBy: { endDate: "desc" }, take: 12 }),
    ctx.db.attendance.findMany({ where: { memberId: member.id }, orderBy: { localDate: "desc" }, take: 120, select: { localDate: true, method: true, checkedInAt: true } }),
    ctx.db.recoveryTask.findMany({ where: { memberId: member.id }, include: { events: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    ctx.db.riskAssessment.findFirst({ where: { memberId: member.id }, orderBy: { assessedAt: "desc" } }),
    ctx.db.riskHistory.findMany({ where: { memberId: member.id }, orderBy: { changedAt: "desc" }, take: 20 }),
  ]);
  return { member, memberships, attendance, tasks, assessment, history };
});

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  trainerId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "FROZEN", "SUSPENDED"]).optional(),
  credentialUid: z.string().trim().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const PATCH = gymRoute({ permission: "members.edit" }, async (ctx, req, params) => {
  const before = await load(ctx, String(params.id));
  const body = await parseJson(req, patchSchema);
  const data: Record<string, unknown> = { ...body };
  if (body.phone !== undefined) {
    data.phone = body.phone ? normalizeNepalPhone(body.phone) : null;
    if (body.phone && !data.phone) throw badRequest("Enter a valid Nepal phone number.");
  }
  if (body.email === "") data.email = null;
  await assertContactFree(ctx.db, { phone: body.phone !== undefined ? (data.phone as string | null) : null, email: body.email ? body.email : null }, before.id);
  if (body.trainerId && !(await ctx.db.staffMember.findFirst({ where: { id: body.trainerId, role: "TRAINER", active: true } }))) throw badRequest("Choose a trainer from this gym.");
  const after = await ctx.db.member.update({ where: { id: before.id }, data });
  await audit({ actor: ctx.actor, action: "members.updated", entityType: "Member", entityId: before.id, gymId: ctx.gym.id, before, after: body });
  return after;
});

/** Archive (soft delete). History is retained for reporting; the member leaves active lists. */
export const DELETE = gymRoute({ permission: "members.delete" }, async (ctx, _req, params) => {
  const before = await load(ctx, String(params.id));
  await ctx.db.member.update({ where: { id: before.id }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
  await audit({ actor: ctx.actor, action: "members.archived", entityType: "Member", entityId: before.id, gymId: ctx.gym.id, before: { fullName: before.fullName } });
  return { ok: true };
});
