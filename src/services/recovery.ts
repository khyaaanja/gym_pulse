import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { predictionConfigFor } from "@/config/prediction";
import { badRequest, notFound } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import type { ContactMethod, RecoveryStatus, RecoveryTask } from "@/generated/prisma/client";
import { notify, wasSent } from "./notifications";

const OPEN: RecoveryStatus[] = ["NOT_CONTACTED", "CONTACTED", "FOLLOW_UP", "RETURNED"];

/** Opens a recovery task for a member unless one is already open (a partial unique index backs this up). */
export async function ensureRecoveryTask(
  gymId: string,
  memberId: string,
  input: { reason: string; monthlyFeePaisa: number; riskAssessmentId?: string; createdById?: string; assignedToId?: string },
): Promise<{ task: RecoveryTask; created: boolean }> {
  const db = tenantDb(gymId);
  const open = await db.recoveryTask.findFirst({ where: { memberId, closedAt: null } });
  if (open) return { task: open, created: false };
  try {
    const task = await db.recoveryTask.create({
      data: {
        gymId,
        memberId,
        reason: input.reason,
        monthlyFeePaisa: input.monthlyFeePaisa,
        riskAssessmentId: input.riskAssessmentId,
        createdById: input.createdById,
        assignedToId: input.assignedToId,
      },
    });
    await db.recoveryEvent.create({ data: { gymId, taskId: task.id, memberId, type: "CREATED", note: input.reason, actorId: input.createdById } });
    return { task, created: true };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const task = await db.recoveryTask.findFirstOrThrow({ where: { memberId, closedAt: null } });
      return { task, created: false };
    }
    throw err;
  }
}

async function openTask(gymId: string, taskId: string) {
  const task = await tenantDb(gymId).recoveryTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Recovery task not found.");
  if (task.closedAt) throw badRequest("This follow-up is already closed.");
  return task;
}

export async function logContact(
  gymId: string,
  taskId: string,
  actorId: string,
  input: { method: ContactMethod; result?: string; note?: string; followUpAt?: Date | null },
) {
  const db = tenantDb(gymId);
  const task = await openTask(gymId, taskId);
  const now = new Date();
  const status: RecoveryStatus = input.followUpAt ? "FOLLOW_UP" : task.status === "RETURNED" ? "RETURNED" : "CONTACTED";
  const updated = await db.recoveryTask.update({
    where: { id: task.id },
    data: { status, lastContactAt: now, contactMethod: input.method, contactResult: input.result, followUpAt: input.followUpAt ?? null },
  });
  const type = input.method === "CALL" ? "CALLED" : input.method === "WHATSAPP" ? "WHATSAPP_OPENED" : "MARKED_CONTACTED";
  await db.recoveryEvent.create({ data: { gymId, taskId, memberId: task.memberId, type, channel: input.method, note: [input.result, input.note].filter(Boolean).join(" — ") || null, actorId } });
  if (input.followUpAt) {
    await db.recoveryEvent.create({ data: { gymId, taskId, memberId: task.memberId, type: "FOLLOW_UP_SET", note: input.followUpAt.toISOString(), actorId } });
  }
  return updated;
}

/** Sends a message through a notification channel and records it as a contact attempt. */
export async function sendRecoveryMessage(
  gymId: string,
  taskId: string,
  actor: { userId: string; name: string },
  input: { channel: "SMS" | "EMAIL" | "WHATSAPP" | "IN_APP"; body: string },
) {
  const task = await openTask(gymId, taskId);
  const n = await notify({ gymId, memberId: task.memberId, channel: input.channel, category: "RECOVERY", title: "A message from your gym", body: input.body });
  const db = tenantDb(gymId);
  const delivered = wasSent(n);
  await db.recoveryEvent.create({
    data: {
      gymId,
      taskId,
      memberId: task.memberId,
      type: delivered ? "MESSAGE_SENT" : "MESSAGE_NOT_SENT",
      channel: input.channel,
      note: delivered ? input.body.slice(0, 280) : `Not delivered: ${n.error ?? "unknown error"}`,
      actorId: actor.userId,
      metadata: { notificationId: n.id, status: n.status },
    },
  });
  if (delivered) {
    await db.recoveryTask.update({
      where: { id: task.id },
      data: { status: task.status === "NOT_CONTACTED" ? "CONTACTED" : task.status, lastContactAt: new Date(), contactMethod: input.channel },
    });
  }
  return n;
}

/** Check-in hook: a member with an open task who shows up is marked as returned. */
export async function onMemberReturned(gymId: string, memberId: string, at: Date) {
  const db = tenantDb(gymId);
  const task = await db.recoveryTask.findFirst({ where: { memberId, closedAt: null, status: { in: ["NOT_CONTACTED", "CONTACTED", "FOLLOW_UP"] } } });
  if (!task) return;
  await db.recoveryTask.update({ where: { id: task.id }, data: { status: "RETURNED", returnedAt: at } });
  await db.recoveryEvent.create({ data: { gymId, taskId: task.id, memberId, type: "MEMBER_RETURNED", note: "Checked in" } });
}

/**
 * Renewal hook. Closes the member's open task as RENEWED. Estimated protected revenue is only
 * attributed when staff actually contacted the member before the renewal — a renewal nobody
 * worked on is recorded, but not credited to the recovery workflow.
 */
export async function onMemberRenewed(gymId: string, memberId: string, at: Date) {
  const db = tenantDb(gymId);
  const task = await db.recoveryTask.findFirst({ where: { memberId, closedAt: null } });
  if (!task) return null;
  const cfg = await predictionConfigFor(gymId);
  const attributed = !!task.lastContactAt && task.lastContactAt <= at;
  const protectedPaisa = attributed ? task.monthlyFeePaisa * cfg.protectedRevenueMonths : null;
  const updated = await db.recoveryTask.update({
    where: { id: task.id },
    data: {
      status: "RENEWED",
      recoveredAt: at,
      closedAt: at,
      protectedRevenuePaisa: protectedPaisa,
      protectedMonths: attributed ? cfg.protectedRevenueMonths : null,
    },
  });
  await db.recoveryEvent.create({
    data: {
      gymId,
      taskId: task.id,
      memberId,
      type: "RENEWED",
      note: attributed
        ? `Estimated protected revenue ${formatMoney(protectedPaisa!)} (${formatMoney(task.monthlyFeePaisa)}/month × ${cfg.protectedRevenueMonths} months)`
        : "Renewed without a recorded contact — not credited as recovered",
    },
  });
  return updated;
}

export async function markRecovered(gymId: string, taskId: string, actorId: string) {
  const task = await openTask(gymId, taskId);
  const db = tenantDb(gymId);
  const updated = await db.recoveryTask.update({ where: { id: task.id }, data: { status: "RETURNED", returnedAt: task.returnedAt ?? new Date() } });
  await db.recoveryEvent.create({ data: { gymId, taskId, memberId: task.memberId, type: "MEMBER_RETURNED", note: "Marked returned by staff", actorId } });
  return updated;
}

export async function markLost(gymId: string, taskId: string, actorId: string, note?: string) {
  const task = await openTask(gymId, taskId);
  const db = tenantDb(gymId);
  const updated = await db.recoveryTask.update({ where: { id: task.id }, data: { status: "LOST", closedAt: new Date() } });
  await db.recoveryEvent.create({ data: { gymId, taskId, memberId: task.memberId, type: "MARKED_LOST", note, actorId } });
  return updated;
}

export async function addNote(gymId: string, taskId: string, actorId: string, note: string) {
  const task = await tenantDb(gymId).recoveryTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound();
  return tenantDb(gymId).recoveryEvent.create({ data: { gymId, taskId, memberId: task.memberId, type: "NOTE", note, actorId } });
}

/** Recovery KPIs for a period. Recovery rate = recovered ÷ contacted among at-risk members. */
export async function recoveryMetrics(gymId: string, since: Date) {
  const db = tenantDb(gymId);
  const [contacted, recovered, protectedAgg, renewedUncredited] = await Promise.all([
    db.recoveryTask.count({ where: { lastContactAt: { gte: since } } }),
    db.recoveryTask.count({ where: { lastContactAt: { not: null }, OR: [{ recoveredAt: { gte: since } }, { returnedAt: { gte: since } }], status: { in: ["RETURNED", "RENEWED"] } } }),
    db.recoveryTask.aggregate({ _sum: { protectedRevenuePaisa: true }, where: { recoveredAt: { gte: since }, protectedRevenuePaisa: { not: null } } }),
    db.recoveryTask.count({ where: { status: "RENEWED", recoveredAt: { gte: since }, protectedRevenuePaisa: null } }),
  ]);
  return {
    contacted,
    recovered,
    recoveryRate: contacted ? recovered / contacted : null,
    protectedRevenuePaisa: protectedAgg._sum.protectedRevenuePaisa ?? 0,
    renewedWithoutContact: renewedUncredited,
  };
}

export async function openTaskCount(gymId: string) {
  return prisma.recoveryTask.count({ where: { gymId, closedAt: null, status: { in: OPEN } } });
}
