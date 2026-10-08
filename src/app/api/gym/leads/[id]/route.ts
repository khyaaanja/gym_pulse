import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

const schema = z.object({
  // CONVERTED is set only by the convert action, which creates the member record.
  status: z.enum(["NEW", "CONTACTED", "TRIAL_BOOKED", "LOST"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const PATCH = gymRoute({ permission: "leads.manage" }, async (ctx, req, params) => {
  const before = await ctx.db.lead.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound("Enquiry not found.");
  if (before.status === "CONVERTED") throw badRequest("This enquiry is already a member.");
  const b = await parseJson(req, schema);
  const after = await ctx.db.lead.update({
    where: { id: before.id },
    data: { ...b, ...(b.status && b.status !== "NEW" && !before.contactedAt ? { contactedAt: new Date() } : {}) },
  });
  await audit({ actor: ctx.actor, action: "leads.updated", entityType: "Lead", entityId: before.id, gymId: ctx.gym.id, before: { status: before.status }, after: b });
  return after;
});
