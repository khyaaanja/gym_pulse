import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { gymSettings } from "@/config/gym-settings";
import { predictionConfigFor } from "@/config/prediction";
import { resolveFlags } from "@/lib/flags";
import { formatMoney } from "@/lib/money";
import { addDays, diffDays, formatDate, fromDbDate, toDbDate, today as todayIn } from "@/lib/time";
import type { AutomationRule, AutomationTrigger, Channel } from "@/generated/prisma/client";
import { notify, notifyStaff, wasSent } from "./notifications";
import type { TemplateKey } from "./notifications/templates";
import { ensureRecoveryTask } from "./recovery";
import type { Transition } from "./risk/run";
import { enqueue } from "./jobs";

type ActionConfig = { template?: TemplateKey; channels?: Channel[]; roles?: ("OWNER" | "MANAGER" | "STAFF" | "TRAINER")[] };
type Conditions = { minDaysInactive?: number };

/** Effective rules for a trigger: a gym rule overrides the platform rule with the same key. */
export async function rulesFor(gymId: string, trigger: AutomationTrigger): Promise<AutomationRule[]> {
  const rows = await prisma.automationRule.findMany({ where: { trigger, OR: [{ gymId: null }, { gymId }] } });
  const byKey = new Map<string, AutomationRule>();
  for (const r of rows.sort((a, b) => (a.gymId ? 1 : 0) - (b.gymId ? 1 : 0))) byKey.set(r.key, r);
  return [...byKey.values()].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
}

/** Every platform rule as this gym sees it, including disabled ones, with the gym's override if any. */
export async function effectiveRules(gymId: string) {
  const rows = await prisma.automationRule.findMany({ where: { OR: [{ gymId: null }, { gymId }] }, orderBy: [{ trigger: "asc" }, { priority: "desc" }] });
  return rows
    .filter((r) => r.gymId === null)
    .map((base) => {
      const own = rows.find((r) => r.gymId === gymId && r.key === base.key) ?? null;
      const rule = own ?? base;
      return {
        key: base.key, name: base.name, trigger: base.trigger, action: base.action, audience: base.audience,
        enabled: rule.enabled, delayMinutes: rule.delayMinutes, overridden: !!own,
        conditions: rule.conditions as Conditions, channels: ((rule.actionConfig ?? {}) as ActionConfig).channels ?? ["IN_APP"],
        platformEnabled: base.enabled,
      };
    });
}

async function claimRun(rule: AutomationRule, gymId: string, subjectId: string, dedupeKey: string) {
  try {
    await prisma.automationRun.create({ data: { ruleId: rule.id, gymId, subjectId, dedupeKey: `${rule.key}:v${rule.version}:${dedupeKey}`, status: "STARTED" } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

async function automationEnabled(gymId: string) {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  return { gym, enabled: (await resolveFlags(gym)).automation };
}

/** MEMBER_INACTIVE: react to members who just crossed into AT_RISK. */
export async function runInactivityAutomation(gymId: string, transitions: Transition[]) {
  const toRisk = transitions.filter((t) => t.to === "AT_RISK");
  if (!toRisk.length) return { flagged: 0 };
  const { gym, enabled } = await automationEnabled(gymId);
  const db = tenantDb(gymId);
  const cfg = await predictionConfigFor(gymId);
  const rules = enabled ? await rulesFor(gymId, "MEMBER_INACTIVE") : [];
  let flagged = 0;

  for (const t of toRisk) {
    const member = await db.member.findUnique({ where: { id: t.memberId }, include: { memberships: { where: { status: "ACTIVE" }, include: { plan: true }, orderBy: { endDate: "desc" }, take: 1 } } });
    if (!member) continue;
    const ms = member.memberships[0];
    const fee = ms ? Math.round((ms.pricePaisa * 30) / ms.plan.durationDays) : 0;
    const daysInactive = member.lastAttendanceAt ? diffDays(fromDbDate(member.lastAttendanceAt), todayIn(gym.timezone)) : cfg.inactivityThresholdDays;
    const episode = member.lastAttendanceAt ? fromDbDate(member.lastAttendanceAt) : "never";

    // Flagging at-risk members for follow-up is core retention behaviour, independent of the automation flag.
    const { created } = await ensureRecoveryTask(gymId, member.id, {
      reason: `${daysInactive} days without a visit`,
      monthlyFeePaisa: fee,
    });
    if (created) flagged++;

    for (const rule of rules) {
      const cond = (rule.conditions ?? {}) as Conditions;
      if (cond.minDaysInactive && daysInactive < cond.minDaysInactive) continue;
      if (!(await claimRun(rule, gymId, member.id, `${member.id}:${episode}`))) continue;
      const ac = (rule.actionConfig ?? {}) as ActionConfig;
      const run = async () => {
        if (rule.action === "NOTIFY_STAFF") {
          for (const channel of ac.channels ?? ["IN_APP"]) {
            await notifyStaff(gymId, ac.roles ?? ["OWNER", "MANAGER", "STAFF"], {
              channel,
              category: "AT_RISK",
              template: ac.template ?? "STAFF_AT_RISK",
              vars: { memberName: member.fullName, daysInactive, fee: formatMoney(fee, gym.currencySymbol) },
              link: `/app/members/${member.id}`,
              dedupeKey: `at-risk:${member.id}:${episode}:${channel}`,
            });
          }
        } else if (rule.action === "SEND_NOTIFICATION" && rule.audience === "MEMBER") {
          for (const channel of ac.channels ?? ["IN_APP"]) {
            await notify({
              gymId,
              memberId: member.id,
              channel,
              category: "INACTIVITY",
              template: ac.template ?? "INACTIVITY",
              vars: { daysInactive },
              link: "/app/attendance",
              dedupeKey: `inactivity:${member.id}:${episode}:${channel}`,
            });
          }
        }
      };
      if (rule.delayMinutes > 0) {
        await enqueue("automation.delayed", { gymId, ruleId: rule.id, memberId: member.id, episode, daysInactive }, { gymId, delayMs: rule.delayMinutes * 60_000 });
      } else {
        await run();
      }
    }
  }
  return { flagged };
}

/** Delayed execution of an inactivity rule: re-checks the member is still at risk before acting. */
export async function runDelayedInactivity(payload: { gymId: string; ruleId: string; memberId: string; episode: string; daysInactive: number }) {
  const db = tenantDb(payload.gymId);
  const member = await db.member.findUnique({ where: { id: payload.memberId } });
  if (!member || member.riskStatus !== "AT_RISK") return { skipped: "member no longer at risk" };
  const rule = await prisma.automationRule.findUnique({ where: { id: payload.ruleId } });
  if (!rule?.enabled) return { skipped: "rule disabled" };
  const ac = (rule.actionConfig ?? {}) as ActionConfig;
  let sent = 0;
  for (const channel of ac.channels ?? ["IN_APP"]) {
    const n = await notify({
      gymId: payload.gymId,
      memberId: member.id,
      channel,
      category: "INACTIVITY",
      template: ac.template ?? "INACTIVITY",
      vars: { daysInactive: payload.daysInactive },
      dedupeKey: `inactivity:${member.id}:${payload.episode}:${channel}`,
    });
    if (wasSent(n)) sent++;
  }
  return { sent };
}

/**
 * Renewal sequence. Offsets come from the gym's settings (default 7, 3, 1, 0 days before and
 * 3 days after expiry). Each (membership, offset, channel) is sent at most once.
 */
export async function runRenewalReminders(gymId: string) {
  const { gym, enabled } = await automationEnabled(gymId);
  if (!enabled) return { sent: 0, skipped: "automation disabled" };
  const expiring = await rulesFor(gymId, "MEMBERSHIP_EXPIRING");
  const expired = await rulesFor(gymId, "MEMBERSHIP_EXPIRED");
  if (!expiring.length && !expired.length) return { sent: 0 };
  const settings = gymSettings(gym.settings);
  const today = todayIn(gym.timezone);
  const offsets = settings.renewal.reminderOffsetsDays;
  const db = tenantDb(gymId);
  const dates = offsets.map((o) => toDbDate(addDays(today, o)));
  const candidates = await db.membership.findMany({
    where: { endDate: { in: dates }, status: { in: ["ACTIVE", "EXPIRED"] }, renewedTo: { is: null } },
    include: { member: true, plan: true },
  });
  let sent = 0;
  for (const m of candidates) {
    if (m.member.archivedAt) continue;
    // Skip if a later membership already exists (renewed through another path).
    const later = await db.membership.count({ where: { memberId: m.memberId, endDate: { gt: m.endDate }, status: "ACTIVE" } });
    if (later) continue;
    const offset = diffDays(today, fromDbDate(m.endDate));
    const after = offset < 0;
    const rules = after ? expired : expiring;
    for (const rule of rules) {
      const ac = (rule.actionConfig ?? {}) as ActionConfig;
      const channels = ac.channels ?? settings.renewal.channels;
      for (const channel of channels) {
        const expiryPhrase = offset === 0 ? "expires today" : offset === 1 ? "expires tomorrow" : offset > 1 ? `expires in ${offset} days` : offset === -1 ? "expired yesterday" : `expired ${-offset} days ago`;
        const n = await notify({
          gymId,
          memberId: m.memberId,
          channel: channel as Channel,
          category: "RENEWAL",
          template: after ? "MEMBERSHIP_EXPIRED" : ac.template ?? "RENEWAL_REMINDER",
          vars: { planName: m.plan.name, expiryDate: formatDate(fromDbDate(m.endDate)), expiryPhrase, renewLink: `${process.env.APP_URL}/app/renew` },
          link: "/app/renew",
          dedupeKey: `renewal:${m.id}:${offset}:${channel}`,
        });
        if (wasSent(n)) sent++;
      }
    }
  }
  return { sent, candidates: candidates.length };
}

export async function onPaymentFailed(gymId: string, paymentId: string) {
  const { enabled } = await automationEnabled(gymId);
  const payment = await tenantDb(gymId).payment.findUnique({ where: { id: paymentId } });
  if (!payment?.memberId || !enabled) return;
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  for (const rule of await rulesFor(gymId, "PAYMENT_FAILED")) {
    if (!(await claimRun(rule, gymId, paymentId, paymentId))) continue;
    const ac = (rule.actionConfig ?? {}) as ActionConfig;
    for (const channel of ac.channels ?? ["IN_APP"]) {
      await notify({
        gymId,
        memberId: payment.memberId,
        channel,
        category: "PAYMENT",
        template: "PAYMENT_FAILED",
        vars: { amount: formatMoney(payment.amountPaisa, gym.currencySymbol), description: payment.purpose === "MEMBERSHIP" ? "your membership" : "your order" },
        link: payment.purpose === "MEMBERSHIP" ? "/app/renew" : "/app/marketplace",
        dedupeKey: `payment-failed:${paymentId}:${channel}`,
      });
    }
  }
}

export async function onMilestoneReached(gymId: string, memberId: string, milestone: string, rewardId: string) {
  const { enabled } = await automationEnabled(gymId);
  if (!enabled) return;
  for (const rule of await rulesFor(gymId, "MILESTONE_REACHED")) {
    if (!(await claimRun(rule, gymId, memberId, rewardId))) continue;
    const ac = (rule.actionConfig ?? {}) as ActionConfig;
    for (const channel of ac.channels ?? ["IN_APP"]) {
      await notify({ gymId, memberId, channel, category: "MILESTONE", template: "MILESTONE_REACHED", vars: { milestone }, link: "/app/attendance", dedupeKey: `milestone:${rewardId}:${channel}` });
    }
  }
}

export async function onMarketplacePurchase(gymId: string, orderId: string) {
  const db = tenantDb(gymId);
  const order = await db.marketplaceOrder.findUnique({ where: { id: orderId }, include: { member: true, items: { include: { bookings: { include: { trainer: true } } } } } });
  if (!order) return;
  // Booking confirmations are part of the purchase itself, not an optional automation.
  for (const item of order.items) {
    for (const b of item.bookings) {
      await notify({ gymId, memberId: order.memberId, channel: "IN_APP", category: "BOOKING", template: "BOOKING_CREATED", vars: { title: b.title }, link: "/app/marketplace", dedupeKey: `booking:${b.id}:member` });
      if (b.trainer) {
        await notify({ gymId, userId: b.trainer.userId, channel: "IN_APP", category: "BOOKING", template: "TRAINER_BOOKING", vars: { title: b.title, memberName: order.member.fullName, sessions: b.sessionsTotal }, link: "/app/bookings", dedupeKey: `booking:${b.id}:trainer` });
      }
    }
  }
  const { enabled } = await automationEnabled(gymId);
  if (!enabled) return;
  for (const rule of await rulesFor(gymId, "MARKETPLACE_PURCHASE")) {
    if (!(await claimRun(rule, gymId, orderId, orderId))) continue;
    await notifyStaff(gymId, (rule.actionConfig as ActionConfig)?.roles ?? ["OWNER", "MANAGER"], { channel: "IN_APP", category: "MARKETPLACE", title: `New order ${order.number}`, body: `${order.member.fullName} placed order ${order.number}.`, link: "/app/marketplace?tab=orders", dedupeKey: `order:${orderId}:staff` });
  }
}
