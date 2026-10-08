import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { resolveLocation } from "@/services/locations";

export const GET = gymRoute({ permission: "settings.manage" }, async (ctx) =>
  ctx.db.checkInDevice.findMany({ select: { id: true, name: true, kind: true, keyPrefix: true, active: true, lastSeenAt: true, createdAt: true, location: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
);

/** Registers an NFC reader / kiosk. The API key is shown exactly once. */
export const POST = gymRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(["NFC_READER", "KIOSK"]), locationId: z.string().max(40).optional().nullable() }));
  const locationId = await resolveLocation(ctx.gym.id, b.locationId);
  const key = `gpd_${randomToken(24)}`;
  const d = await ctx.db.checkInDevice.create({ data: { gymId: ctx.gym.id, name: b.name, kind: b.kind, keyHash: sha256(key), keyPrefix: key.slice(0, 8), locationId } });
  await audit({ actor: ctx.actor, action: "devices.created", entityType: "CheckInDevice", entityId: d.id, gymId: ctx.gym.id, after: { name: b.name, kind: b.kind, locationId } });
  return { id: d.id, apiKey: key };
});
