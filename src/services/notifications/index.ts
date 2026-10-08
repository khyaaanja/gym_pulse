import { prisma } from "@/db/client";
import { resolveFlags, type FlagKey } from "@/lib/flags";
import { withinLimit } from "@/lib/limits";
import { log } from "@/lib/logger";
import type { Channel } from "@/generated/prisma/enums";
import { enqueue } from "../jobs";
import { adapterFor, channelConfigured, NotConfigured, PermanentSendError } from "./providers";
import { hasActiveDevice, NoDevices, pushConfigured, sendPushToUser } from "./push";
import { render, resolveTemplate, type TemplateKey } from "./templates";

export type NotifyInput = {
  gymId: string | null;
  channel: Channel;
  category: string;
  /** A user account (staff or member with an app login). Needed for IN_APP. */
  userId?: string | null;
  /** A member record — supplies phone/email when there's no user account. */
  memberId?: string | null;
  template?: TemplateKey;
  vars?: Record<string, string | number | null | undefined>;
  title?: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
  /** Security/system messages ignore opt-outs. */
  essential?: boolean;
};

const CHANNEL_FLAG: Partial<Record<Channel, FlagKey>> = { SMS: "sms", EMAIL: "email", WHATSAPP: "whatsapp" };

/** A notification counts as sent only if it wasn't skipped or failed (QUEUED will be delivered by the worker). */
export const wasSent = (n: { status: string }) => n.status !== "SKIPPED" && n.status !== "FAILED";

/**
 * Creates a notification and, for external channels, queues delivery. Idempotent on `dedupeKey`.
 * Never throws for "can't deliver" situations — those are recorded as SKIPPED with a reason so
 * the UI can say exactly why (not configured, opted out, no phone on file, plan limit).
 */
export async function notify(input: NotifyInput) {
  if (input.dedupeKey) {
    const existing = await prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return existing;
  }

  const [gym, member, user] = await Promise.all([
    input.gymId ? prisma.gym.findUnique({ where: { id: input.gymId } }) : null,
    input.memberId ? prisma.member.findUnique({ where: { id: input.memberId } }) : null,
    input.userId ? prisma.user.findUnique({ where: { id: input.userId } }) : null,
  ]);
  if (member && input.gymId && member.gymId !== input.gymId) throw new Error("notify: member belongs to another gym");
  const userId = input.userId ?? member?.userId ?? null;

  let title = input.title ?? "";
  let body = input.body ?? "";
  let templateVersion: number | null = null;
  if (input.template) {
    const t = await resolveTemplate(input.gymId, input.template, input.channel);
    const vars = {
      gymName: gym?.name,
      firstName: (member?.fullName ?? user?.name ?? "").split(" ")[0],
      ...input.vars,
    };
    title = render(t.subject, vars);
    body = render(t.body, vars);
    templateVersion = t.version;
  }

  let toAddress: string | null = null;
  let skip: string | null = null;
  switch (input.channel) {
    case "IN_APP":
      if (!userId) skip = "Member hasn't activated their app account";
      break;
    case "SMS":
    case "WHATSAPP":
      toAddress = member?.phone ?? user?.phone ?? null;
      if (!toAddress) skip = "No phone number on file";
      break;
    case "EMAIL":
      toAddress = member?.email ?? user?.email ?? null;
      if (!toAddress) skip = "No email address on file";
      break;
    case "PUSH":
      if (!userId) skip = "Member hasn't activated their app account";
      else if (!pushConfigured()) skip = "Push notifications aren't set up on this server";
      else if (!(await hasActiveDevice(userId))) skip = "No devices have push turned on";
      break;
  }

  if (!skip && gym) {
    const flag = CHANNEL_FLAG[input.channel];
    if (flag && !(await resolveFlags(gym))[flag]) skip = `${input.channel} messaging isn't enabled for this gym`;
    if (!skip && input.channel !== "IN_APP" && input.channel !== "PUSH" && !(await withinLimit(gym.id, "notificationsPerMonth", gym.timezone))) {
      skip = "Monthly message limit reached for this plan";
    }
  }
  // Decide "no provider" now rather than in the worker, so callers (and the staff UI) learn at once
  // that nothing will be sent instead of seeing QUEUED for a message that can never go out.
  if (!skip && !(await channelConfigured(input.channel))) skip = `No ${input.channel === "WHATSAPP" ? "WhatsApp" : input.channel} provider is set up yet`;
  if (!skip && userId && !input.essential) {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_category_channel: { userId, category: input.category, channel: input.channel } },
    });
    if (pref && !pref.enabled) skip = "Recipient opted out of this notification";
  }

  try {
    const n = await prisma.notification.create({
      data: {
        gymId: input.gymId,
        userId,
        memberId: input.memberId ?? null,
        channel: input.channel,
        category: input.category,
        title,
        body,
        link: input.link,
        toAddress,
        templateKey: input.template,
        templateVersion,
        dedupeKey: input.dedupeKey,
        status: skip ? "SKIPPED" : input.channel === "IN_APP" ? "SENT" : "QUEUED",
        error: skip,
        sentAt: !skip && input.channel === "IN_APP" ? new Date() : null,
      },
    });
    if (n.status === "QUEUED") await enqueue("notification.send", { notificationId: n.id }, { gymId: input.gymId, maxAttempts: 4 });
    if (n.channel === "IN_APP" && n.status === "SENT" && n.userId) await mirrorToPush(n, input);
    return n;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002" && input.dedupeKey) {
      return prisma.notification.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey } });
    }
    throw err;
  }
}

/**
 * Every in-app notification also buzzes the recipient's phones when they have push on. It is a separate row
 * (own status, own opt-out under PUSH) whose link opens — and marks read — the in-app original.
 * Users without a push device get no PUSH row at all, so the log isn't flooded with "skipped".
 */
async function mirrorToPush(n: { id: string; userId: string | null; category: string; title: string; body: string }, input: NotifyInput) {
  if (!n.userId || !(await hasActiveDevice(n.userId))) return;
  try {
    await notify({
      gymId: input.gymId,
      channel: "PUSH",
      category: n.category,
      userId: n.userId,
      title: n.title,
      body: n.body,
      link: `/app/n/${n.id}`,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:push` : `push:${n.id}`,
      essential: input.essential,
    });
  } catch (err) {
    // The in-app notification already exists; a push hiccup must not fail the caller.
    log.warn("notification.push_mirror_failed", { notificationId: n.id, error: (err as Error).message });
  }
}

async function dispatchPush(n: { id: string; userId: string | null; category: string; title: string; body: string; link: string | null }) {
  try {
    const res = await sendPushToUser(n.userId!, { title: n.title, body: n.body, url: n.link ?? "/app/notifications", tag: n.id, category: n.category });
    await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), providerKey: "webpush", providerMessageId: `${res.delivered} device(s)`, attempts: { increment: 1 }, error: null } });
    return { sent: true };
  } catch (err) {
    if (err instanceof NoDevices) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: err.message.slice(0, 500), attempts: { increment: 1 } } });
      return { skipped: true, reason: "no_devices" };
    }
    await prisma.notification.update({ where: { id: n.id }, data: { error: (err as Error).message.slice(0, 500), attempts: { increment: 1 } } });
    throw err; // every device failed transiently → retry with backoff
  }
}

/** Job handler: deliver one queued notification through its channel provider. */
export async function dispatchNotification(notificationId: string) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!n || n.status !== "QUEUED") return { skipped: true };
  if (n.channel === "PUSH") return dispatchPush(n);
  try {
    const { adapter, creds } = await adapterFor(n.channel);
    const res = await adapter.send({ to: n.toAddress!, subject: n.title, body: n.body }, creds);
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "SENT", sentAt: new Date(), providerKey: adapter.key, providerMessageId: res.providerMessageId, attempts: { increment: 1 }, error: null },
    });
    return { sent: true };
  } catch (err) {
    if (err instanceof NotConfigured) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Not configured", attempts: { increment: 1 } } });
      await recordUndelivered(n.id, "Not configured");
      return { skipped: true, reason: "not_configured" };
    }
    const permanent = err instanceof PermanentSendError;
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: permanent ? "FAILED" : "QUEUED", error: (err as Error).message.slice(0, 500), attempts: { increment: 1 } },
    });
    log.warn("notification.send_failed", { notificationId, channel: n.channel, permanent, error: (err as Error).message });
    if (permanent) {
      await recordUndelivered(n.id, (err as Error).message);
      return { failed: true };
    }
    throw err; // transient → job retries with backoff; the job system dead-letters after max attempts
  }
}

/** Called when a notification job is dead-lettered so the row doesn't stay QUEUED forever. */
export async function markNotificationFailed(notificationId: string, reason: string) {
  const r = await prisma.notification.updateMany({ where: { id: notificationId, status: "QUEUED" }, data: { status: "FAILED", error: reason.slice(0, 500) } });
  if (r.count) await recordUndelivered(notificationId, reason);
}

/** A queued recovery message that ends up undelivered must not stay logged as sent. */
async function recordUndelivered(notificationId: string, reason: string) {
  await prisma.recoveryEvent.updateMany({
    where: { type: "MESSAGE_SENT", metadata: { path: ["notificationId"], equals: notificationId } },
    data: { type: "MESSAGE_NOT_SENT", note: `Not delivered: ${reason}`.slice(0, 500) },
  });
}

/** Notify every active staff member of a gym who holds `permission`-like role. */
export async function notifyStaff(gymId: string, roles: ("OWNER" | "MANAGER" | "STAFF" | "TRAINER")[], input: Omit<NotifyInput, "gymId" | "userId" | "memberId">) {
  const staff = await prisma.staffMember.findMany({ where: { gymId, active: true, role: { in: roles } }, select: { userId: true } });
  return Promise.all(
    staff.map((s) => notify({ ...input, gymId, userId: s.userId, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${s.userId}` : undefined })),
  );
}
