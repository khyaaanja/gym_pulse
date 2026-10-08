import webpush, { WebPushError } from "web-push";
import { prisma } from "@/db/client";
import { env } from "@/config/env";
import { log } from "@/lib/logger";

export type PushPayload = { title: string; body: string; url: string; tag: string; category: string };

export const MAX_DEVICES_PER_USER = 10;

/** Web Push works only with both VAPID keys present. */
export function pushConfigured() {
  const e = env();
  return !!(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey() {
  return pushConfigured() ? env().VAPID_PUBLIC_KEY! : null;
}

// The server POSTs to whatever endpoint a browser hands it, so accept only the real browser push services.
// Anything else (an internal address, a metadata IP, an attacker's host) would turn push into an SSRF.
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"];

export function isAllowedPushEndpoint(endpoint: string) {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  // Chrome builds also hand out FCM endpoints on regional Google hosts (e.g. jmt17.google.com/fcm/send/…).
  if (host.endsWith(".google.com") && u.pathname.startsWith("/fcm/send/")) return true;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/** Devices whose registering session is still live. A signed-out or expired session never receives pushes. */
export function activeDevices(userId: string) {
  return prisma.pushSubscription.findMany({
    where: { userId, session: { revokedAt: null, expiresAt: { gt: new Date() } } },
    orderBy: { createdAt: "desc" },
    take: MAX_DEVICES_PER_USER,
  });
}

export async function hasActiveDevice(userId: string) {
  if (!pushConfigured()) return false;
  const n = await prisma.pushSubscription.count({ where: { userId, session: { revokedAt: null, expiresAt: { gt: new Date() } } } });
  return n > 0;
}

export class NoDevices extends Error {}

/**
 * Sends one payload to every live device of a user. Resolves when at least one device accepted it;
 * subscriptions the push service reports as gone (404/410) are deleted. Throws when nothing was delivered:
 * `NoDevices` when there is nowhere to send, a plain Error (retryable) when every device failed transiently.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) throw new NoDevices("Push not configured");
  const devices = await activeDevices(userId);
  if (!devices.length) throw new NoDevices("No devices registered for push");

  const data = JSON.stringify({ ...payload, title: payload.title.slice(0, 120), body: payload.body.slice(0, 400) });
  const options = {
    vapidDetails: { subject: e.VAPID_SUBJECT, publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
    TTL: 12 * 60 * 60,
    urgency: (payload.category === "AT_RISK" || payload.category === "PAYMENT" || payload.category === "SYSTEM" ? "high" : "normal") as "high" | "normal",
    timeout: 15_000,
  };

  let delivered = 0;
  let lastError: string | null = null;
  for (const d of devices) {
    if (!isAllowedPushEndpoint(d.endpoint)) {
      await prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => undefined);
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, data, options);
      delivered++;
      await prisma.pushSubscription.update({ where: { id: d.id }, data: { lastSentAt: new Date(), failures: 0 } });
    } catch (err) {
      const status = err instanceof WebPushError ? err.statusCode : 0;
      lastError = `${status || "network"}: ${(err as Error).message}`.slice(0, 300);
      if (status === 404 || status === 410 || status === 403) {
        // Gone, or the key pair changed — this subscription can never succeed again.
        await prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => undefined);
      } else {
        const updated = await prisma.pushSubscription.update({ where: { id: d.id }, data: { failures: { increment: 1 } } }).catch(() => null);
        if (updated && updated.failures >= 5) await prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => undefined);
      }
      log.warn("push.send_failed", { userId, status, error: (err as Error).message });
    }
  }
  if (delivered) return { delivered };
  const remaining = await activeDevices(userId);
  if (!remaining.length) throw new NoDevices(lastError ? `No reachable devices (${lastError})` : "No devices registered for push");
  throw new Error(`Push failed on every device: ${lastError}`);
}
