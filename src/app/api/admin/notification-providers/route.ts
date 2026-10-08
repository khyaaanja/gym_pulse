import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { PROVIDER_CATALOG } from "@/services/notifications/providers";

export const GET = adminRoute({ permission: "notifications.manage" }, async () => {
  const [rows, stats] = await Promise.all([
    prisma.notificationProviderConfig.findMany(),
    prisma.notification.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: true }),
  ]);
  return PROVIDER_CATALOG.map((p) => {
    const row = rows.find((r) => r.channel === p.channel && r.providerKey === p.key);
    const creds = decryptJson<Record<string, string>>(row?.credentialsEnc) ?? {};
    const ch = stats.filter((s) => s.channel === p.channel);
    const total = ch.reduce((a, s) => a + s._count, 0);
    const sent = ch.filter((s) => s.status === "SENT" || s.status === "DELIVERED").reduce((a, s) => a + s._count, 0);
    const failed = ch.filter((s) => s.status === "FAILED").reduce((a, s) => a + s._count, 0);
    return {
      ...p,
      enabled: row?.enabled ?? false,
      status: row ? (row.enabled ? "Configured" : "Disabled") : "Not configured",
      configured: Object.fromEntries(p.fields.map((f) => [f, !!creds[f]])),
      dailyLimit: row?.dailyLimit ?? null,
      usage30d: { total, sent, failed, skipped: ch.filter((s) => s.status === "SKIPPED").reduce((a, s) => a + s._count, 0) },
      deliveryRate: total ? sent / total : null,
      failureRate: total ? failed / total : null,
    };
  });
});

/** Credentials are write-only: they are encrypted and never sent back. */
export const PUT = adminRoute({ permission: "notifications.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ key: z.string(), enabled: z.boolean(), dailyLimit: z.number().int().min(0).nullable().optional(), credentials: z.record(z.string(), z.string().max(500)).default({}) }));
  const def = PROVIDER_CATALOG.find((p) => p.key === b.key);
  if (!def) throw badRequest("Unknown provider.");
  const existing = await prisma.notificationProviderConfig.findUnique({ where: { channel_providerKey: { channel: def.channel, providerKey: def.key } } });
  const creds = { ...(decryptJson<Record<string, string>>(existing?.credentialsEnc) ?? {}) };
  for (const f of def.fields) if (b.credentials[f]) creds[f] = b.credentials[f]!;
  if (b.enabled && def.fields.some((f) => !creds[f])) throw badRequest(`Enter ${def.fields.join(", ")} before enabling.`);
  const data = { enabled: b.enabled, dailyLimit: b.dailyLimit ?? null, credentialsEnc: encryptJson(creds), displayName: def.name, updatedById: ctx.admin.id };
  await prisma.notificationProviderConfig.upsert({ where: { channel_providerKey: { channel: def.channel, providerKey: def.key } }, create: { ...data, channel: def.channel, providerKey: def.key }, update: data });
  if (b.enabled) await prisma.notificationProviderConfig.updateMany({ where: { channel: def.channel, providerKey: { not: def.key } }, data: { enabled: false } });
  await audit({ actor: ctx.actor, action: "notifications.provider_updated", entityType: "NotificationProviderConfig", entityId: def.key, after: { enabled: b.enabled, fieldsUpdated: Object.keys(b.credentials).filter((k) => b.credentials[k]) } });
  return { ok: true };
});
