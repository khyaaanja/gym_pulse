import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { gymSettings, gymSettingsPatchSchema, gymSettingsSchema } from "@/config/gym-settings";
import { predictionConfigFor } from "@/config/prediction";
import { normalizeNepalPhone } from "@/lib/phone";
import { badRequest } from "@/lib/errors";
import { assertOwnImage } from "@/services/files";

export const GET = gymRoute({ permission: "settings.manage", allowSuspended: true }, async (ctx) => {
  const cfg = await predictionConfigFor(ctx.gym.id);
  return { gym: ctx.gym, settings: gymSettings(ctx.gym.settings), retention: { inactivityThresholdDays: cfg.inactivityThresholdDays, protectedRevenueMonths: cfg.protectedRevenueMonths }, flags: ctx.flags };
});

const schema = z.object({
  profile: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    address: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(60).nullable().optional(),
    province: z.string().trim().max(60).nullable().optional(),
    currencySymbol: z.enum(["₹", "Rs.", "रु", "NPR"]).optional(),
    logoFileId: z.string().nullable().optional(),
  }).optional(),
  settings: gymSettingsPatchSchema.optional(),
  // Bounded: super admin sets the platform default; gyms can tune within these limits.
  retention: z.object({ inactivityThresholdDays: z.number().int().min(5).max(60).optional(), protectedRevenueMonths: z.number().int().min(1).max(24).optional() }).optional(),
});

export const PATCH = gymRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const before = { profile: ctx.gym, settings: ctx.gym.settings };
  const data: Record<string, unknown> = {};
  if (b.profile) {
    await assertOwnImage(ctx.gym.id, b.profile.logoFileId, "LOGO");
    Object.assign(data, b.profile);
    if (b.profile.phone) {
      const p = normalizeNepalPhone(b.profile.phone);
      if (!p) throw badRequest("Enter a valid phone number.");
      data.phone = p;
    }
  }
  if (b.settings) {
    if (b.settings.branding?.accentColor && !ctx.flags.custom_branding) throw badRequest("Custom branding isn't available on your plan.");
    const merged = { ...gymSettings(ctx.gym.settings), ...b.settings };
    data.settings = gymSettingsSchema.parse(merged);
  }
  const gym = await prisma.gym.update({ where: { id: ctx.gym.id }, data });
  if (b.retention) {
    await prisma.predictionConfig.upsert({ where: { gymId: ctx.gym.id }, create: { gymId: ctx.gym.id, ...b.retention, updatedById: ctx.user.id }, update: { ...b.retention, updatedById: ctx.user.id } });
  }
  await audit({ actor: ctx.actor, action: "settings.updated", entityType: "Gym", entityId: ctx.gym.id, gymId: ctx.gym.id, before, after: b });
  return { gym };
});
