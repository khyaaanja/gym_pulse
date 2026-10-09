import { prisma, type Tx } from "@/db/client";
import { tenantDb, type TenantDb } from "@/db/tenant";
import { addDays, fromDbDate, toDbDate, today as todayIn, type DateOnly } from "@/lib/time";
import { monthlyEquivalent } from "@/lib/money";
import { badRequest, notFound } from "@/lib/errors";
import type { Membership, MembershipPlan, Prisma, RecordSource } from "@/generated/prisma/client";

export type ActiveMembership = Membership & { plan: MembershipPlan };

export async function activeMembership(db: TenantDb | Tx, memberId: string, on: DateOnly): Promise<ActiveMembership | null> {
  return (db as TenantDb).membership.findFirst({
    where: { memberId, status: "ACTIVE", startDate: { lte: toDbDate(on) }, endDate: { gte: toDbDate(on) } },
    include: { plan: true },
    orderBy: { endDate: "desc" },
  });
}

/** The membership that currently runs furthest into the future (active or queued renewal). */
export async function latestMembership(db: TenantDb | Tx, memberId: string) {
  return (db as TenantDb).membership.findFirst({
    where: { memberId, status: { in: ["ACTIVE", "EXPIRED"] } },
    include: { plan: true },
    orderBy: { endDate: "desc" },
  });
}

/**
 * Memberships the desk should renew: ending within the next 14 days or still inside the grace period, not already
 * renewed, and with no later membership starting (renewed through another path). Every filter is in the query, so
 * `take` can only cut the list short, never hide a due member behind one that was filtered out afterwards; `total`
 * is the true count so the page can say when it is showing only part of the list.
 */
export async function dueForRenewal(db: TenantDb, opts: { today: DateOnly; graceDays: number; memberWhere?: Prisma.MemberWhereInput; take: number }) {
  const where: Prisma.MembershipWhereInput = {
    status: { in: ["ACTIVE", "EXPIRED"] },
    endDate: { gte: toDbDate(addDays(opts.today, -opts.graceDays)), lte: toDbDate(addDays(opts.today, 14)) },
    renewedTo: { is: null },
    member: { archivedAt: null, ...opts.memberWhere, memberships: { none: { startDate: { gt: toDbDate(opts.today) } } } },
  };
  const [rows, total] = await Promise.all([
    db.membership.findMany({ where, include: { member: { select: { id: true, fullName: true, phone: true } }, plan: true }, orderBy: { endDate: "asc" }, take: opts.take }),
    db.membership.count({ where }),
  ]);
  return { rows, total };
}

export function membershipMonthlyFee(m: { pricePaisa: number; plan: { durationDays: number } }) {
  return monthlyEquivalent(m.pricePaisa, m.plan.durationDays);
}

/**
 * Renewal extends from the day after the current end date so a member who renews early
 * never loses days. A lapsed member starts from today.
 */
export async function renewMembership(
  tx: Tx,
  gymId: string,
  memberId: string,
  planId: string,
  pricePaisa: number,
  today: DateOnly,
  source: RecordSource = "MANUAL",
) {
  const plan = await tx.membershipPlan.findFirst({ where: { id: planId, gymId } });
  if (!plan) throw notFound("That membership plan doesn't exist.");
  const latest = await tx.membership.findFirst({
    where: { gymId, memberId, status: { in: ["ACTIVE", "EXPIRED"] } },
    orderBy: { endDate: "desc" },
  });
  const latestEnd = latest ? fromDbDate(latest.endDate) : null;
  const start = latestEnd && latestEnd >= today ? addDays(latestEnd, 1) : today;
  const end = addDays(start, plan.durationDays - 1);
  const canChain = latest && !(await tx.membership.findFirst({ where: { renewedFromId: latest.id } }));
  return tx.membership.create({
    data: {
      gymId,
      memberId,
      planId,
      startDate: toDbDate(start),
      endDate: toDbDate(end),
      pricePaisa,
      status: "ACTIVE",
      source,
      isRenewal: !!latest,
      renewedFromId: canChain ? latest!.id : null,
    },
    include: { plan: true },
  });
}

export async function createInitialMembership(db: TenantDb, memberId: string, planId: string, startDate: DateOnly) {
  const plan = await db.membershipPlan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw badRequest("Choose an active membership plan.");
  return db.membership.create({
    data: {
      gymId: plan.gymId,
      memberId,
      planId,
      startDate: toDbDate(startDate),
      endDate: toDbDate(addDays(startDate, plan.durationDays - 1)),
      pricePaisa: plan.pricePaisa,
      status: "ACTIVE",
    },
  });
}

/** Nightly: ACTIVE memberships whose end date has passed become EXPIRED. */
export async function expireMemberships(gymId: string) {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const res = await tenantDb(gymId).membership.updateMany({
    where: { status: "ACTIVE", endDate: { lt: toDbDate(todayIn(gym.timezone)) } },
    data: { status: "EXPIRED" },
  });
  return { expired: res.count };
}
