import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createLocation } from "@/services/locations";

export const GET = gymRoute({ permission: "attendance.view" }, async (ctx) =>
  ctx.db.location.findMany({ orderBy: [{ isPrimary: "desc" }, { active: "desc" }, { name: "asc" }] }),
);

export const POST = gymRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ name: z.string().trim().min(2).max(60), address: z.string().trim().max(200).optional().nullable() }));
  const l = await createLocation(ctx.gym.id, b, ctx.flags.multi_location);
  await audit({ actor: ctx.actor, action: "locations.created", entityType: "Location", entityId: l.id, gymId: ctx.gym.id, after: l });
  return l;
});
