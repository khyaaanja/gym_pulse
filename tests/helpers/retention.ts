import { prisma } from "@/db/client";
import { addDays, localInstant, today as todayIn, toDbDate } from "@/lib/time";
import { makeGym } from "./fixtures";

export const TZ = "Asia/Kathmandu";
export const day = (offset = 0) => addDays(todayIn(TZ), offset);

/** A member with an active membership ending in `endsIn` days and a live check-in `daysAgo` days ago (null = never). */
export async function seedMember(
  gymId: string,
  planId: string,
  o: { daysAgo: number | null; endsIn?: number; pricePaisa?: number; trainerId?: string; phone?: string | null; userId?: string; name?: string } = { daysAgo: null },
) {
  const id = Math.random().toString(36).slice(2, 10);
  const member = await prisma.member.create({
    data: {
      gymId, memberCode: `R-${id}`, fullName: o.name ?? `Ret Member ${id}`, joinedOn: toDbDate(day(-60)), phone: o.phone === undefined ? `98${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` : o.phone,
      trainerId: o.trainerId, userId: o.userId,
      lastAttendanceAt: o.daysAgo === null ? null : localInstant(day(-o.daysAgo), "09:00", TZ),
    },
  });
  if (o.daysAgo !== null) {
    await prisma.attendance.create({ data: { gymId, memberId: member.id, localDate: toDbDate(day(-o.daysAgo)), checkedInAt: localInstant(day(-o.daysAgo), "09:00", TZ), method: "STAFF" } });
  }
  const membership = await prisma.membership.create({
    data: { gymId, memberId: member.id, planId, startDate: toDbDate(day(-30 + (o.endsIn ?? 20))), endDate: toDbDate(day(o.endsIn ?? 20)), pricePaisa: o.pricePaisa ?? 150_000, status: "ACTIVE" },
  });
  return { member, membership };
}

export async function gymWithPlan() {
  return makeGym();
}

/** Platform automation rules (gymId null). Idempotent; matches prisma/seed.ts. */
export async function ensurePlatformRules() {
  const rules = [
    { key: "inactive-staff-alert", name: "Alert staff", trigger: "MEMBER_INACTIVE", action: "NOTIFY_STAFF", audience: "STAFF", actionConfig: { template: "STAFF_AT_RISK", channels: ["IN_APP"], roles: ["OWNER", "MANAGER", "STAFF"] }, conditions: {}, priority: 10 },
    { key: "inactive-member-nudge", name: "Member nudge", trigger: "MEMBER_INACTIVE", action: "SEND_NOTIFICATION", audience: "MEMBER", conditions: { minDaysInactive: 14 }, actionConfig: { template: "INACTIVITY", channels: ["IN_APP", "SMS"] }, priority: 5 },
    { key: "renewal-sequence", name: "Renewal reminders", trigger: "MEMBERSHIP_EXPIRING", action: "SEND_NOTIFICATION", audience: "MEMBER", conditions: {}, actionConfig: { template: "RENEWAL_REMINDER" }, priority: 10 },
    { key: "expired-followup", name: "Post-expiry reminder", trigger: "MEMBERSHIP_EXPIRED", action: "SEND_NOTIFICATION", audience: "MEMBER", conditions: {}, actionConfig: { template: "MEMBERSHIP_EXPIRED" }, priority: 5 },
  ] as const;
  for (const r of rules) {
    if (!(await prisma.automationRule.findFirst({ where: { gymId: null, key: r.key } }))) {
      await prisma.automationRule.create({ data: { ...r, gymId: null, conditions: r.conditions as never, actionConfig: r.actionConfig as never } });
    }
  }
}
