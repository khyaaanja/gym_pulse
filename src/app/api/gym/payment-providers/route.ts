import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";

/** Gym merchant accounts. Credentials are encrypted and never returned — only which fields are set. */
export const GET = gymRoute({ permission: "settings.manage" }, async (ctx) => {
  const rows = await prisma.paymentProviderConfig.findMany({ where: { OR: [{ gymId: null }, { gymId: ctx.gym.id }] } });
  return rows
    .filter((r) => r.gymId === null && r.enabled && r.providerKey !== "sandbox")
    .map((platform) => {
      const mine = rows.find((r) => r.gymId === ctx.gym.id && r.providerKey === platform.providerKey);
      const creds = mine ? decryptJson<Record<string, string>>(mine.credentialsEnc) ?? {} : {};
      return {
        providerKey: platform.providerKey,
        displayName: platform.displayName,
        fields: PAYMENT_ADAPTERS[platform.providerKey]?.credentialFields ?? [],
        configured: Object.fromEntries((PAYMENT_ADAPTERS[platform.providerKey]?.credentialFields ?? []).map((f) => [f, !!creds[f]])),
        enabled: mine?.enabled ?? false,
        environment: mine?.environment ?? "SANDBOX",
        status: mine ? (mine.enabled ? "Connected" : "Disabled") : "Not configured",
      };
    });
});

const schema = z.object({
  providerKey: z.enum(["esewa", "khalti"]),
  environment: z.enum(["SANDBOX", "LIVE"]),
  enabled: z.boolean(),
  // Omitted/empty fields keep the stored value; secrets are write-only.
  credentials: z.record(z.string(), z.string().max(300)).default({}),
});

export const PUT = gymRoute({ permission: "settings.manage", feature: "payments" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const platform = await prisma.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: b.providerKey, enabled: true } });
  if (!platform) throw badRequest("That provider isn't available on GymPulse right now.");
  const existing = await prisma.paymentProviderConfig.findFirst({ where: { gymId: ctx.gym.id, providerKey: b.providerKey } });
  const fields = PAYMENT_ADAPTERS[b.providerKey]!.credentialFields;
  const creds = { ...(decryptJson<Record<string, string>>(existing?.credentialsEnc) ?? {}) };
  for (const f of fields) if (b.credentials[f]) creds[f] = b.credentials[f]!.trim();
  if (b.enabled && fields.some((f) => !creds[f])) throw badRequest(`Enter ${fields.join(" and ")} to connect ${platform.displayName}.`);
  const data = { environment: b.environment, enabled: b.enabled, credentialsEnc: encryptJson(creds), displayName: platform.displayName, methods: platform.methods, updatedById: ctx.user.id };
  if (existing) await prisma.paymentProviderConfig.update({ where: { id: existing.id }, data });
  else await prisma.paymentProviderConfig.create({ data: { ...data, gymId: ctx.gym.id, providerKey: b.providerKey } });
  await audit({ actor: ctx.actor, action: "payments.provider_updated", entityType: "PaymentProviderConfig", gymId: ctx.gym.id, after: { providerKey: b.providerKey, environment: b.environment, enabled: b.enabled, fieldsUpdated: Object.keys(b.credentials).filter((k) => b.credentials[k]) } });
  return { ok: true };
});
