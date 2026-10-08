import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

export const POST = adminRoute({ permission: "gyms.manage" }, async (ctx, req, params) => {
  const gym = await prisma.gym.findUnique({ where: { id: String(params.id) } });
  if (!gym) throw notFound();
  const b = await parseJson(req, z.object({ action: z.enum(["suspend", "reactivate", "archive"]), reason: z.string().trim().min(3, "Give a reason — it's recorded in the audit log.").max(300) }));
  let data;
  if (b.action === "suspend") {
    if (gym.status === "ARCHIVED") throw badRequest("Archived gyms can't be suspended.");
    data = { status: "SUSPENDED" as const, suspendedAt: new Date(), suspendedReason: b.reason };
  } else if (b.action === "reactivate") {
    if (gym.status !== "SUSPENDED") throw badRequest("Only suspended gyms can be reactivated.");
    data = { status: "ACTIVE" as const, suspendedAt: null, suspendedReason: null };
  } else {
    data = { status: "ARCHIVED" as const, archivedAt: new Date() };
  }
  const after = await prisma.gym.update({ where: { id: gym.id }, data });
  if (b.action === "archive") await prisma.subscription.updateMany({ where: { gymId: gym.id }, data: { status: "CANCELLED" } });
  await audit({ actor: ctx.actor, action: { suspend: "gyms.suspended", reactivate: "gyms.reactivated", archive: "gyms.archived" }[b.action], entityType: "Gym", entityId: gym.id, gymId: gym.id, before: { status: gym.status }, after: { status: after.status, reason: b.reason } });
  return after;
});
