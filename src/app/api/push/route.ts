import { z } from "zod";
import { userRoute, parseJson, parseQuery } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/db/client";
import { isAllowedPushEndpoint, MAX_DEVICES_PER_USER, vapidPublicKey } from "@/services/notifications/push";

/** Push setup for this browser: the VAPID key to subscribe with, and whether this device is on for this session. */
export const GET = userRoute({}, async (ctx, req) => {
  const q = parseQuery(req, z.object({ endpoint: z.string().max(2048).optional() }));
  const publicKey = vapidPublicKey();
  const [thisDevice, devices] = await Promise.all([
    q.endpoint ? prisma.pushSubscription.count({ where: { endpoint: q.endpoint, userId: ctx.user.id, sessionId: ctx.session.id } }) : 0,
    prisma.pushSubscription.count({ where: { userId: ctx.user.id, session: { revokedAt: null, expiresAt: { gt: new Date() } } } }),
  ]);
  return { configured: !!publicKey, publicKey, thisDevice: thisDevice > 0, devices };
});

const subscription = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(16).max(64) }),
});

export const POST = userRoute({}, async (ctx, req) => {
  if (!vapidPublicKey()) throw badRequest("Push notifications aren't set up on this server.");
  await rateLimit(`push-sub:${ctx.user.id}`, 20, 3600);
  const b = await parseJson(req, subscription);
  if (!isAllowedPushEndpoint(b.endpoint)) throw badRequest("This browser's push service isn't supported.");
  const data = { userId: ctx.user.id, sessionId: ctx.session.id, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: ctx.meta.userAgent?.slice(0, 300) ?? null, failures: 0 };
  // An endpoint identifies one browser profile; if someone else signed in on it before, it now belongs to this user.
  await prisma.pushSubscription.upsert({ where: { endpoint: b.endpoint }, create: { endpoint: b.endpoint, ...data }, update: data });
  const extra = await prisma.pushSubscription.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES_PER_USER, select: { id: true } });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  return { ok: true };
});

export const DELETE = userRoute({}, async (ctx, req) => {
  const b = await parseJson(req, z.object({ endpoint: z.string().max(2048) }));
  const r = await prisma.pushSubscription.deleteMany({ where: { endpoint: b.endpoint, userId: ctx.user.id } });
  return { removed: r.count };
});
