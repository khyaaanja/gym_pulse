import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { normalizeNepalPhone } from "@/lib/phone";
import { isValidDateOnly, toDbDate } from "@/lib/time";

const STATUSES = ["NEW", "CONTACTED", "TRIAL_BOOKED", "CONVERTED", "LOST"] as const;

export const GET = gymRoute({ permission: "leads.manage" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(STATUSES).optional() }));
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    ctx.db.lead.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { referrer: { select: { fullName: true, memberCode: true } }, promotion: { select: { title: true } } } }),
    ctx.db.lead.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter their name.").max(80),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email("Enter a valid email.").nullable().optional().or(z.literal("")),
  goal: z.string().trim().max(80).nullable().optional(),
  source: z.enum(["WALK_IN", "PHONE", "SOCIAL", "REFERRAL", "OTHER"]).default("WALK_IN"),
  preferredVisitOn: z.string().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** Desk staff log a walk-in or phone enquiry so it gets followed up like the online ones. */
export const POST = gymRoute({ permission: "leads.manage" }, async (ctx, req) => {
  const b = await parseJson(req, createSchema);
  const phone = b.phone ? normalizeNepalPhone(b.phone) : null;
  if (b.phone && !phone) throw badRequest("Enter a valid Nepal mobile number (e.g. 98XXXXXXXX).");
  if (!phone && !b.email) throw badRequest("Add a mobile number or email so someone can follow up.");
  const visit = b.preferredVisitOn?.slice(0, 10);
  const lead = await ctx.db.lead.create({
    data: { gymId: ctx.gym.id, name: b.name, phone, email: b.email ? b.email.toLowerCase() : null, goal: b.goal ?? null, source: b.source, notes: b.notes ?? null, preferredVisitOn: visit && isValidDateOnly(visit) ? toDbDate(visit) : null },
  });
  await audit({ actor: ctx.actor, action: "leads.created", entityType: "Lead", entityId: lead.id, gymId: ctx.gym.id, after: { name: lead.name, source: lead.source } });
  return lead;
});
