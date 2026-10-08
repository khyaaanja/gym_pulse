import { z } from "zod";

/** Gym-level operational settings stored in Gym.settings (JSON). Defaults apply for missing keys. */
export const gymSettingsSchema = z.object({
  attendance: z
    .object({
      allowSelfQr: z.boolean().default(true),
      allowStaffCheckIn: z.boolean().default(true),
      kioskQrRotateSeconds: z.number().int().min(30).max(600).default(60),
      requireActiveMembership: z.boolean().default(true),
    })
    .default({ allowSelfQr: true, allowStaffCheckIn: true, kioskQrRotateSeconds: 60, requireActiveMembership: true }),
  renewal: z
    .object({
      // Days relative to expiry: positive = before, 0 = on expiry day, negative = after
      reminderOffsetsDays: z.array(z.number().int().min(-30).max(60)).max(8).default([7, 3, 1, 0, -3]),
      gracePeriodDays: z.number().int().min(0).max(30).default(5),
      channels: z.array(z.enum(["IN_APP", "SMS", "EMAIL", "WHATSAPP"])).default(["IN_APP", "SMS"]),
    })
    .default({ reminderOffsetsDays: [7, 3, 1, 0, -3], gracePeriodDays: 5, channels: ["IN_APP", "SMS"] }),
  imports: z
    .object({
      rawFileRetentionDays: z.number().int().min(1).max(90).default(7),
      dateOrder: z.enum(["DMY", "MDY", "YMD"]).default("DMY"),
    })
    .default({ rawFileRetentionDays: 7, dateOrder: "DMY" }),
  marketplace: z
    .object({
      contextualSuggestions: z.boolean().default(true),
    })
    .default({ contextualSuggestions: true }),
  engagement: z
    .object({
      // Rest days a member may take between visits without breaking their streak.
      streakRestDays: z.number().int().min(0).max(3).default(1),
    })
    .default({ streakRestDays: 1 }),
  branding: z
    .object({
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .default({}),
  // The public gym page (/g/<slug>) and online joining. Off until the owner turns it on.
  publicPage: z
    .object({
      enabled: z.boolean().default(false),
      allowSelfSignup: z.boolean().default(false),
      listInDirectory: z.boolean().default(true),
      showPrices: z.boolean().default(true),
      tagline: z.string().trim().max(120).optional(),
      about: z.string().trim().max(1500).optional(),
      openingHours: z.string().trim().max(300).optional(),
      amenities: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    })
    .default({ enabled: false, allowSelfSignup: false, listInDirectory: true, showPrices: true, amenities: [] }),
  growth: z
    .object({
      // What a member and their friend get when the friend joins, shown on the referral card and the public page.
      referralReward: z.string().trim().max(160).optional(),
    })
    .default({}),
});

export type GymSettings = z.infer<typeof gymSettingsSchema>;

type Shape = typeof gymSettingsSchema.shape;
/**
 * For updates: each section optional and WITHOUT its default, so a section that isn't sent is left alone.
 * (`gymSettingsSchema.partial()` still fills in every missing section's default, which silently reset all other
 * settings whenever one section was saved.)
 */
export const gymSettingsPatchSchema = z.object(
  Object.fromEntries(Object.entries(gymSettingsSchema.shape).map(([k, v]) => [k, v.unwrap().optional()])) as { [K in keyof Shape]: z.ZodOptional<ReturnType<Shape[K]["unwrap"]>> },
);

export function gymSettings(raw: unknown): GymSettings {
  const parsed = gymSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : gymSettingsSchema.parse({});
}
