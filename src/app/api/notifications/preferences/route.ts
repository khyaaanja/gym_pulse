import { z } from "zod";
import { userRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";

const CATEGORIES = ["AT_RISK", "RENEWAL", "PAYMENT", "MARKETPLACE", "MILESTONE", "INACTIVITY", "BOOKING", "SYSTEM"] as const;
const CHANNELS = ["IN_APP", "PUSH", "SMS", "EMAIL", "WHATSAPP"] as const;

export const GET = userRoute({}, async (ctx) => {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: ctx.user.id } });
  return {
    categories: CATEGORIES,
    channels: CHANNELS,
    preferences: CATEGORIES.flatMap((category) => CHANNELS.map((channel) => ({ category, channel, enabled: prefs.find((p) => p.category === category && p.channel === channel)?.enabled ?? true }))),
  };
});

export const PUT = userRoute({}, async (ctx, req) => {
  const b = await parseJson(req, z.object({ preferences: z.array(z.object({ category: z.enum(CATEGORIES), channel: z.enum(CHANNELS), enabled: z.boolean() })).max(64) }));
  for (const p of b.preferences) {
    await prisma.notificationPreference.upsert({ where: { userId_category_channel: { userId: ctx.user.id, category: p.category, channel: p.channel } }, create: { userId: ctx.user.id, ...p }, update: { enabled: p.enabled } });
  }
  return { ok: true };
});
