import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { FLAG_DEFS, FLAG_KEYS } from "@/lib/flags";
import { badRequest } from "@/lib/errors";

export const GET = adminRoute({ permission: "flags.manage" }, async () => {
  const [rows, plans] = await Promise.all([prisma.featureFlag.findMany(), prisma.saasPlan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } })]);
  return { defs: FLAG_KEYS.map((k) => ({ key: k, label: FLAG_DEFS[k].label, default: FLAG_DEFS[k].default })), rows, plans };
});

/** Set or clear (enabled: null) an override at GLOBAL, PLAN or GYM scope. Checked server-side on every request. */
export const PUT = adminRoute({ permission: "flags.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ key: z.enum(FLAG_KEYS as [string, ...string[]]), scope: z.enum(["GLOBAL", "PLAN", "GYM"]), scopeId: z.string().default(""), enabled: z.boolean().nullable() }));
  if (b.scope === "GLOBAL" && b.scopeId) throw badRequest("Global flags have no scope id.");
  if (b.scope === "PLAN" && !(await prisma.saasPlan.findUnique({ where: { id: b.scopeId } }))) throw badRequest("Unknown plan.");
  if (b.scope === "GYM" && !(await prisma.gym.findUnique({ where: { id: b.scopeId } }))) throw badRequest("Unknown gym.");
  const where = { key_scope_scopeId: { key: b.key, scope: b.scope, scopeId: b.scopeId } };
  const before = await prisma.featureFlag.findUnique({ where });
  if (b.enabled === null) await prisma.featureFlag.deleteMany({ where: { key: b.key, scope: b.scope, scopeId: b.scopeId } });
  else await prisma.featureFlag.upsert({ where, create: { key: b.key, scope: b.scope, scopeId: b.scopeId, enabled: b.enabled, updatedById: ctx.admin.id }, update: { enabled: b.enabled, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "flags.changed", entityType: "FeatureFlag", entityId: `${b.key}:${b.scope}:${b.scopeId}`, gymId: b.scope === "GYM" ? b.scopeId : null, before, after: b });
  return { ok: true };
});
