import type { TenantDb } from "@/db/tenant";
import { conflict } from "@/lib/errors";
import { toDbDate, type DateOnly } from "@/lib/time";
import type { RecordSource } from "@/generated/prisma/enums";

/** Next free "M-00001"-style member ID. Probes forward, so archived or deleted members never cause a clash. */
export async function nextMemberCode(db: TenantDb, used: Set<string> = new Set()) {
  let n = (await db.member.count()) + 1;
  for (;;) {
    const code = `M-${String(n).padStart(5, "0")}`;
    if (!used.has(code.toLowerCase()) && !(await db.member.findFirst({ where: { memberCode: code } }))) {
      used.add(code.toLowerCase());
      return code;
    }
    n++;
  }
}

/**
 * Refuses a mobile number or email that another active member of this gym already uses — the same rule the import
 * flow applies (a matching phone is a strong duplicate). Archived members don't count, so a returning member can be re-added.
 */
export async function assertContactFree(db: TenantDb, contact: { phone?: string | null; email?: string | null }, exceptMemberId?: string) {
  const { phone, email } = contact;
  if (!phone && !email) return;
  const clash = await db.member.findFirst({
    where: {
      archivedAt: null,
      ...(exceptMemberId ? { id: { not: exceptMemberId } } : {}),
      OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])],
    },
    select: { fullName: true, memberCode: true, phone: true, email: true },
  });
  if (!clash) return;
  const samePhone = !!phone && clash.phone === phone;
  const field = samePhone ? "phone" : "email";
  const what = samePhone ? "mobile number" : "email";
  const message = `${clash.fullName} (${clash.memberCode}) already uses this ${what}. Open their profile instead, or use a different ${what}.`;
  throw conflict(message, [{ path: field, message }]);
}

export type NewMember = {
  gymId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  joinedOn: DateOnly;
  source: RecordSource;
  memberCode?: string | null;
  trainerId?: string | null;
  userId?: string | null;
  referredById?: string | null;
  promotionId?: string | null;
  notes?: string | null;
};

/**
 * Creates a member with the next free member ID. Two people adding members at the same moment can pick the same
 * ID; the loser simply takes the next one. A caller-chosen `memberCode` is never silently replaced.
 */
export async function createMemberRecord(db: TenantDb, m: NewMember) {
  let memberCode = m.memberCode || (await nextMemberCode(db));
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.member.create({
        data: {
          gymId: m.gymId, fullName: m.fullName, phone: m.phone, email: m.email, memberCode, joinedOn: toDbDate(m.joinedOn), source: m.source,
          trainerId: m.trainerId || null, userId: m.userId ?? null, referredById: m.referredById ?? null, promotionId: m.promotionId ?? null, notes: m.notes ?? null,
        },
      });
    } catch (err) {
      if (m.memberCode || (err as { code?: string }).code !== "P2002" || attempt >= 4) throw err;
      memberCode = await nextMemberCode(db);
    }
  }
}
