import { gymRoute } from "@/lib/api";
import { audit } from "@/lib/audit";

export const DELETE = gymRoute({ permission: "settings.manage" }, async (ctx, _req, params) => {
  await ctx.db.checkInDevice.update({ where: { id: String(params.id) }, data: { active: false } });
  await audit({ actor: ctx.actor, action: "devices.revoked", entityType: "CheckInDevice", entityId: String(params.id), gymId: ctx.gym.id });
  return { ok: true };
});
