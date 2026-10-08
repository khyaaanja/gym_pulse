import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { updateLocation } from "@/services/locations";

const schema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  address: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});

export const PATCH = gymRoute({ permission: "settings.manage" }, async (ctx, req, params) => {
  const { before, after } = await updateLocation(ctx.gym.id, String(params.id), await parseJson(req, schema), ctx.flags.multi_location);
  await audit({ actor: ctx.actor, action: "locations.updated", entityType: "Location", entityId: after.id, gymId: ctx.gym.id, before, after });
  return after;
});
