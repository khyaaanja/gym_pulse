import { prisma } from "@/db/client";
import { audit, SYSTEM_ACTOR, type AuditActor } from "@/lib/audit";
import { notFound, badRequest } from "@/lib/errors";
import { MONEY_TX } from "@/lib/tx";

const periodMs = (p: "MONTHLY" | "YEARLY") => (p === "YEARLY" ? 365 : 30) * 86_400_000;

/**
 * Daily SaaS billing cycle:
 * - trial ended → issue first invoice, subscription ACTIVE (with a 7-day payment window)
 * - period ended → roll period forward and issue the next invoice (idempotent per period)
 * - invoice unpaid 7 days past due → subscription PAST_DUE (gym is NOT auto-suspended; that's an admin decision)
 */
export async function runSubscriptionBilling(now = new Date()) {
  const subs = await prisma.subscription.findMany({ where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } }, include: { plan: true, gym: true } });
  let issued = 0, pastDue = 0;
  for (const s of subs) {
    if (s.gym.status === "ARCHIVED") continue;
    if (s.currentPeriodEnd <= now) {
      if (s.cancelAtPeriodEnd) {
        await prisma.subscription.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
        continue;
      }
      const start = s.currentPeriodEnd;
      const end = new Date(start.getTime() + periodMs(s.plan.billingPeriod));
      const created = await prisma.subscriptionInvoice.upsert({
        where: { subscriptionId_periodStart: { subscriptionId: s.id, periodStart: start } },
        create: {
          gymId: s.gymId,
          subscriptionId: s.id,
          number: `SUB-${start.toISOString().slice(0, 7).replace("-", "")}-${s.gymId.slice(-6).toUpperCase()}`,
          amountPaisa: s.plan.pricePaisa,
          periodStart: start,
          periodEnd: end,
          dueAt: new Date(start.getTime() + 7 * 86_400_000),
        },
        update: {},
      });
      await prisma.subscription.update({ where: { id: s.id }, data: { currentPeriodStart: start, currentPeriodEnd: end, status: s.status === "TRIALING" ? "ACTIVE" : s.status } });
      if (s.status === "TRIALING") await prisma.gym.update({ where: { id: s.gymId }, data: { status: s.gym.status === "TRIAL" ? "ACTIVE" : s.gym.status } });
      if (created) issued++;
    }
    const overdue = await prisma.subscriptionInvoice.count({ where: { subscriptionId: s.id, status: "DUE", dueAt: { lt: now } } });
    if (overdue && s.status !== "PAST_DUE") {
      await prisma.subscription.update({ where: { id: s.id }, data: { status: "PAST_DUE" } });
      await audit({ actor: SYSTEM_ACTOR, action: "subscription.past_due", entityType: "Subscription", entityId: s.id, gymId: s.gymId });
      pastDue++;
    }
  }
  return { issued, pastDue };
}

/** Finance admin records an offline payment (bank transfer / cheque) against an invoice. */
export async function markInvoicePaid(invoiceId: string, paymentRef: string, actor: AuditActor) {
  const inv = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound();
  if (inv.status === "PAID") throw badRequest("Invoice already paid.");
  const paid = await prisma.$transaction(async (tx) => {
    const p = await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: "PAID", paidAt: new Date(), paymentRef } });
    await tx.ledgerEntry.create({ data: { gymId: inv.gymId, account: "SAAS_REVENUE", amountPaisa: inv.amountPaisa, description: `Subscription ${inv.number}` } });
    const stillDue = await tx.subscriptionInvoice.count({ where: { subscriptionId: inv.subscriptionId, status: "DUE", dueAt: { lt: new Date() } } });
    if (!stillDue) await tx.subscription.updateMany({ where: { id: inv.subscriptionId, status: "PAST_DUE" }, data: { status: "ACTIVE" } });
    return p;
  }, MONEY_TX);
  await audit({ actor, action: "subscription.invoice_paid", entityType: "SubscriptionInvoice", entityId: invoiceId, gymId: inv.gymId, after: { paymentRef } });
  return paid;
}
