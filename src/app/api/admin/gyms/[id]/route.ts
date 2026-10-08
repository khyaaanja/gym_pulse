import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound, badRequest } from "@/lib/errors";
import { usage, type LimitKind } from "@/lib/limits";
import { resolveFlags } from "@/lib/flags";

export const GET = adminRoute({ permission: "gyms.view" }, async (_ctx, _req, params) => {
  const gym = await prisma.gym.findUnique({ where: { id: String(params.id) }, include: { plan: true, subscription: { include: { invoices: { orderBy: { periodStart: "desc" }, take: 12 } } }, supportAdmin: { select: { id: true, name: true } }, staff: { include: { user: { select: { name: true, email: true, phone: true, lastLoginAt: true } } } }, locations: true } });
  if (!gym) throw notFound();
  const kinds: LimitKind[] = ["members", "staff", "importsPerMonth", "predictionsPerMonth", "notificationsPerMonth"];
  const used = Object.fromEntries(await Promise.all(kinds.map(async (k) => [k, await usage(gym.id, k, gym.timezone)] as const)));
  const flags = await resolveFlags(gym);
  const overrides = await prisma.featureFlag.findMany({ where: { scope: "GYM", scopeId: gym.id } });
  const audits = await prisma.auditLog.findMany({ where: { gymId: gym.id }, orderBy: { createdAt: "desc" }, take: 30 });
  return { gym, usage: used, flags, overrides, audits };
});

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  city: z.string().max(60).nullable().optional(),
  province: z.string().max(60).nullable().optional(),
  timezone: z.string().max(60).optional(),
  planId: z.string().optional(),
  supportAdminId: z.string().nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
});

export const PATCH = adminRoute({ permission: "gyms.manage" }, async (ctx, req, params) => {
  const before = await prisma.gym.findUnique({ where: { id: String(params.id) } });
  if (!before) throw notFound();
  const b = await parseJson(req, schema);
  if (b.timezone && !Intl.supportedValuesOf("timeZone").includes(b.timezone)) throw badRequest("Unknown timezone.");
  if (b.planId && !(await prisma.saasPlan.findUnique({ where: { id: b.planId } }))) throw badRequest("Unknown plan.");
  const after = await prisma.$transaction(async (tx) => {
    const g = await tx.gym.update({ where: { id: before.id }, data: { ...b, trialEndsAt: b.trialEndsAt === undefined ? undefined : b.trialEndsAt ? new Date(b.trialEndsAt) : null } });
    if (b.planId) await tx.subscription.updateMany({ where: { gymId: before.id }, data: { planId: b.planId } });
    return g;
  });
  await audit({ actor: ctx.actor, action: b.planId && b.planId !== before.planId ? "gyms.plan_changed" : "gyms.updated", entityType: "Gym", entityId: before.id, gymId: before.id, before, after: b });
  return after;
});
