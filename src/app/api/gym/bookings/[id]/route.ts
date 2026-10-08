import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { canSeeBooking } from "@/lib/scope";

const schema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  sessionsUsed: z.number().int().min(0).max(500).optional(),
  trainerId: z.string().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const PATCH = gymRoute({ permission: "bookings.manage" }, async (ctx, req, params) => {
  const b = await ctx.db.booking.findUnique({ where: { id: String(params.id) } });
  if (!b || !canSeeBooking(ctx, b)) throw notFound();
  const body = await parseJson(req, schema);
  if (body.sessionsUsed !== undefined && body.sessionsUsed > b.sessionsTotal) throw badRequest("Sessions used can't exceed sessions purchased.");
  if (body.trainerId && !(await ctx.db.staffMember.findFirst({ where: { id: body.trainerId, role: "TRAINER" } }))) throw badRequest("Choose a trainer from this gym.");
  const after = await ctx.db.booking.update({ where: { id: b.id }, data: { ...body, scheduledAt: body.scheduledAt === undefined ? undefined : body.scheduledAt ? new Date(body.scheduledAt) : null } });
  await audit({ actor: ctx.actor, action: "bookings.updated", entityType: "Booking", entityId: b.id, gymId: ctx.gym.id, before: b, after: body });
  return after;
});
