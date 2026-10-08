import { prisma } from "@/db/client";

export const FLAG_DEFS = {
  attendance: { label: "Attendance", default: true },
  streaks: { label: "Streaks, challenges & rewards", default: true },
  churn_prediction: { label: "Churn estimation", default: true },
  file_import: { label: "Spreadsheet / file import", default: true },
  ocr_import: { label: "Photo (OCR) import", default: true },
  marketplace: { label: "Marketplace", default: true },
  payments: { label: "Online payments", default: true },
  automation: { label: "Automations", default: true },
  whatsapp: { label: "WhatsApp messaging", default: false },
  sms: { label: "SMS messaging", default: true },
  email: { label: "Email messaging", default: true },
  advanced_analytics: { label: "Advanced analytics", default: false },
  multi_location: { label: "Multi-location", default: false },
  api_access: { label: "API access", default: false },
  custom_branding: { label: "Custom branding", default: false },
} as const;

export type FlagKey = keyof typeof FLAG_DEFS;
export const FLAG_KEYS = Object.keys(FLAG_DEFS) as FlagKey[];

/** Resolution order: GYM override → PLAN → GLOBAL → built-in default. Always evaluated server-side. */
export async function resolveFlags(gym: { id: string; planId: string | null }): Promise<Record<FlagKey, boolean>> {
  const rows = await prisma.featureFlag.findMany({
    where: {
      OR: [
        { scope: "GLOBAL", scopeId: "" },
        ...(gym.planId ? [{ scope: "PLAN" as const, scopeId: gym.planId }] : []),
        { scope: "GYM", scopeId: gym.id },
      ],
    },
  });
  const rank = { GLOBAL: 0, PLAN: 1, GYM: 2 } as const;
  const out = Object.fromEntries(FLAG_KEYS.map((k) => [k, FLAG_DEFS[k].default])) as Record<FlagKey, boolean>;
  const best: Partial<Record<FlagKey, number>> = {};
  for (const r of rows) {
    if (!(r.key in FLAG_DEFS)) continue;
    const k = r.key as FlagKey;
    if ((best[k] ?? -1) <= rank[r.scope]) {
      best[k] = rank[r.scope];
      out[k] = r.enabled;
    }
  }
  return out;
}

export async function isEnabled(gym: { id: string; planId: string | null }, key: FlagKey): Promise<boolean> {
  return (await resolveFlags(gym))[key];
}
