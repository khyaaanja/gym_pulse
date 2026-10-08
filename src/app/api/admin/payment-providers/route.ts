import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";

export const GET = adminRoute({ permission: "payments.manage" }, async () => {
  const rows = await prisma.paymentProviderConfig.findMany({ where: { gymId: null } });
  const gymCounts = await prisma.paymentProviderConfig.groupBy({ by: ["providerKey"], where: { gymId: { not: null }, enabled: true }, _count: true });
  const recent = await prisma.payment.groupBy({ by: ["provider", "status"], where: { method: "ONLINE", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true });
  return Object.values(PAYMENT_ADAPTERS).map((a) => {
    const row = rows.find((r) => r.providerKey === a.key);
    const creds = decryptJson<Record<string, string>>(row?.credentialsEnc) ?? {};
    const mine = recent.filter((r) => r.provider === a.key);
    const total = mine.reduce((x, r) => x + r._count, 0);
    const failed = mine.filter((r) => r.status === "FAILED").reduce((x, r) => x + r._count, 0);
    return {
      key: a.key, name: a.name, methods: row?.methods ?? a.methods, enabled: row?.enabled ?? false, environment: row?.environment ?? "SANDBOX", currency: row?.currency ?? "NPR",
      platformCredentials: Object.fromEntries(a.credentialFields.map((f) => [f, !!creds[f]])),
      connectedGyms: gymCounts.find((g) => g.providerKey === a.key)?._count ?? 0,
      webhookUrl: `${process.env.APP_URL}/api/webhooks/payments/${a.key}`,
      returnUrl: `${process.env.APP_URL}/api/payments/return/${a.key}`,
      health: total === 0 ? "No recent traffic" : failed / total > 0.3 ? "Degraded" : "Healthy",
      last7d: { total, failed },
      productionSafe: a.key !== "sandbox",
    };
  });
});

export const PUT = adminRoute({ permission: "payments.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ key: z.string(), enabled: z.boolean(), environment: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"), methods: z.array(z.string().max(30)).max(10).optional(), credentials: z.record(z.string(), z.string().max(300)).default({}) }));
  const a = PAYMENT_ADAPTERS[b.key];
  if (!a) throw badRequest("Unknown provider.");
  if (b.key === "sandbox" && b.enabled && process.env.APP_ENV === "production") throw badRequest("The test gateway can't be enabled in production.");
  const existing = await prisma.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: b.key } });
  const creds = { ...(decryptJson<Record<string, string>>(existing?.credentialsEnc) ?? {}) };
  for (const f of a.credentialFields) if (b.credentials[f]) creds[f] = b.credentials[f]!;
  const data = { enabled: b.enabled, environment: b.environment, methods: b.methods ?? a.methods, credentialsEnc: encryptJson(creds), displayName: a.name, updatedById: ctx.admin.id };
  if (existing) await prisma.paymentProviderConfig.update({ where: { id: existing.id }, data });
  else await prisma.paymentProviderConfig.create({ data: { ...data, gymId: null, providerKey: b.key } });
  await audit({ actor: ctx.actor, action: "payments.platform_provider_updated", entityType: "PaymentProviderConfig", entityId: b.key, after: { enabled: b.enabled, environment: b.environment } });
  return { ok: true };
});
