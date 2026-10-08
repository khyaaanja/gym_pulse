import { randomInt } from "node:crypto";
import { prisma } from "@/db/client";
import { tenantDb, type TenantDb } from "@/db/tenant";
import { gymSettings, type GymSettings } from "@/config/gym-settings";
import { audit, type AuditActor } from "@/lib/audit";
import { AppError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { withinLimit } from "@/lib/limits";
import { hashPassword } from "@/lib/auth/password";
import { daysAgo, isValidDateOnly, toDbDate, today as todayIn } from "@/lib/time";
import type { Gym, LeadSource, Member } from "@/generated/prisma/client";
import { assertContactFree, createMemberRecord } from "./members";
import { notifyStaff } from "./notifications";

// ─────────────────────────────── Public gym page ───────────────────────────────

const PUBLIC_STATUSES = ["TRIAL", "ACTIVE"] as const;

/** A gym whose owner turned the public page on. Suspended, closed and unpublished gyms are indistinguishable (null). */
export async function publicGym(slug: string): Promise<(Gym & { cfg: GymSettings }) | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const gym = await prisma.gym.findUnique({ where: { slug } });
  if (!gym || !(PUBLIC_STATUSES as readonly string[]).includes(gym.status)) return null;
  const cfg = gymSettings(gym.settings);
  return cfg.publicPage.enabled ? { ...gym, cfg } : null;
}

/** Offers that are switched on and inside their date window right now. */
export function livePromotionWhere(now = new Date()) {
  return {
    active: true,
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

export async function livePromotions(gymId: string, opts: { publicOnly?: boolean } = {}) {
  return tenantDb(gymId).gymPromotion.findMany({
    where: { ...livePromotionWhere(), ...(opts.publicOnly ? { showOnPublicPage: true } : {}) },
    include: { coupon: { select: { code: true, kind: true, value: true, active: true, validUntil: true } }, plan: { select: { id: true, name: true, pricePaisa: true, durationDays: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** A promotion id from a shared link, only if it is live at this gym. Anything else is ignored, never an error. */
async function livePromotion(db: TenantDb, id: string | null | undefined) {
  if (!id || id.length > 40) return null;
  return db.gymPromotion.findFirst({ where: { id, ...livePromotionWhere() }, include: { coupon: { select: { code: true, active: true } } } });
}

// ─────────────────────────────── Referrals ───────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newReferralCode = () => Array.from({ length: 7 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
export const normalizeReferralCode = (code: string | null | undefined) => (code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/** The member's personal referral code, created on first use. Random, so it says nothing about the member. */
export async function ensureReferralCode(db: TenantDb, member: Pick<Member, "id" | "referralCode">): Promise<string> {
  if (member.referralCode) return member.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    try {
      // Conditional: two tabs opening the card at once keep whichever code landed first.
      const r = await db.member.updateMany({ where: { id: member.id, referralCode: null }, data: { referralCode: code } });
      if (r.count === 1) return code;
      const now = await db.member.findUnique({ where: { id: member.id }, select: { referralCode: true } });
      if (now?.referralCode) return now.referralCode;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
  throw new Error("Could not allocate a referral code");
}

/** The active member a referral code belongs to at this gym, or null. */
export async function referrerByCode(db: TenantDb, code: string | null | undefined) {
  const c = normalizeReferralCode(code);
  if (c.length < 5) return null;
  return db.member.findFirst({ where: { referralCode: c, archivedAt: null }, select: { id: true, fullName: true } });
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

// ─────────────────────────────── Leads (enquiries) ───────────────────────────────

export type LeadInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  goal?: string | null;
  message?: string | null;
  preferredVisitOn?: string | null;
  ref?: string | null;
  promo?: string | null;
};

const OPEN_LEAD = { status: { in: ["NEW", "CONTACTED", "TRIAL_BOOKED"] as ("NEW" | "CONTACTED" | "TRIAL_BOOKED")[] } };

/**
 * A free-trial request or enquiry from the public page. The same phone/email asking again within 30 days adds a
 * note to the open enquiry instead of creating another. Nobody is signed in here, so a repeat never changes the
 * enquiry's name, contact details, goal or date — otherwise anyone who knows a number could swap in their own email
 * and receive the member invite later. The response never says whether they enquired before.
 */
export async function submitLead(gym: Gym, input: LeadInput) {
  if (!input.phone && !input.email) throw badRequest("Add a mobile number or email so the gym can reach you.");
  const db = tenantDb(gym.id);
  const [referrer, promo] = await Promise.all([referrerByCode(db, input.ref), livePromotion(db, input.promo)]);
  const preferredVisitOn = input.preferredVisitOn && isValidDateOnly(input.preferredVisitOn) && input.preferredVisitOn >= todayIn(gym.timezone) ? toDbDate(input.preferredVisitOn) : null;
  const source: LeadSource = promo ? "PROMOTION" : referrer ? "REFERRAL" : "PUBLIC_PAGE";
  const contact = [...(input.phone ? [{ phone: input.phone }] : []), ...(input.email ? [{ email: { equals: input.email, mode: "insensitive" as const } }] : [])];
  const existing = await db.lead.findFirst({ where: { ...OPEN_LEAD, createdAt: { gte: daysAgo(30) }, OR: contact }, orderBy: { createdAt: "desc" } });
  if (existing) {
    if (input.message) {
      const note = `Asked again (${input.name}): ${input.message}`;
      await db.lead.update({ where: { id: existing.id }, data: { notes: [existing.notes, note].filter(Boolean).join("\n").slice(-2000) } });
    }
    return { id: existing.id, repeat: true };
  }
  const lead = await db.lead.create({
    data: { gymId: gym.id, name: input.name, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, goal: input.goal ?? null, message: input.message ?? null, preferredVisitOn, source, referrerMemberId: referrer?.id ?? null, promotionId: promo?.id ?? null },
  });
  await notifyStaff(gym.id, ["OWNER", "MANAGER", "STAFF"], {
    channel: "IN_APP",
    category: "GROWTH",
    title: `New enquiry: ${input.name}`,
    body: `${input.name} asked about ${promo ? `"${promo.title}"` : "joining"}${referrer ? ` (referred by ${referrer.fullName})` : ""}. Call them back while they're keen.`,
    link: "/app/grow",
  });
  return { id: lead.id, repeat: false };
}

/** Staff turn an enquiry into a member record. Claims the lead conditionally so a double click can't create two. */
export async function convertLead(gym: Gym, db: TenantDb, leadId: string, actor: AuditActor) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Enquiry not found.");
  if (lead.status === "CONVERTED") throw conflict("This enquiry is already a member.");
  await assertContactFree(db, { phone: lead.phone, email: lead.email });
  const claimed = await db.lead.updateMany({ where: { id: lead.id, status: { not: "CONVERTED" } }, data: { status: "CONVERTED" } });
  if (claimed.count === 0) throw conflict("This enquiry is already a member.");
  try {
    const member = await createMemberRecord(db, {
      gymId: gym.id, fullName: lead.name, phone: lead.phone, email: lead.email, joinedOn: todayIn(gym.timezone), source: "MANUAL",
      referredById: lead.referrerMemberId, promotionId: lead.promotionId,
    });
    await db.lead.update({ where: { id: lead.id }, data: { convertedMemberId: member.id } });
    await audit({ actor, action: "leads.converted", entityType: "Lead", entityId: lead.id, gymId: gym.id, after: { memberId: member.id } });
    return member;
  } catch (err) {
    await db.lead.update({ where: { id: lead.id }, data: { status: lead.status } });
    throw err;
  }
}

// ─────────────────────────────── Joining online ───────────────────────────────

export type JoinInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  planId?: string | null;
  ref?: string | null;
  promo?: string | null;
};

/**
 * Someone joins a gym from its public page. Signed in → their account joins. Not signed in → a new account is
 * created; an email/phone that already has an account must sign in first (no password is checked here, so this
 * can't be used to guess one).
 *
 * The member gets no membership: they pay for a plan next (/app/renew), so joining alone never grants gym access.
 * A phone/email that matches an existing, unclaimed member record is NOT linked to it — anyone could type someone
 * else's number — and nothing in the reply reveals the match. Staff see a "possible duplicate" note instead.
 */
export async function joinGymOnline(gym: Gym & { cfg: GymSettings }, input: JoinInput, sessionUserId: string | null, meta: { ip: string | null; userAgent: string | null }) {
  if (!gym.cfg.publicPage.allowSelfSignup) throw forbidden("This gym doesn't take online sign-ups yet. Send them an enquiry instead.");
  const db = tenantDb(gym.id);

  let user = sessionUserId ? await prisma.user.findUnique({ where: { id: sessionUserId } }) : null;
  if (user) {
    if (await prisma.staffMember.count({ where: { gymId: gym.id, userId: user.id, active: true } })) throw badRequest("You're on this gym's team already, so you don't need to join as a member.");
    const already = await db.member.findFirst({ where: { userId: user.id, archivedAt: null } });
    if (already) return { userId: user.id, memberId: already.id, newAccount: false, redirect: "/app" };
  }
  if (!(await withinLimit(gym.id, "members", gym.timezone))) throw new AppError(403, "not_accepting", "This gym isn't taking online sign-ups right now. Please contact them directly.");

  let newAccount = false;
  if (!user) {
    const email = input.email?.toLowerCase() ?? null;
    if (!email || !input.password) throw badRequest("Enter your email and a password to create your account.");
    const taken = await prisma.user.findFirst({ where: { OR: [{ email }, ...(input.phone ? [{ phone: input.phone }] : [])] }, select: { id: true } });
    if (taken) throw new AppError(409, "sign_in_required", "You already have a GymPulse account with this email or phone. Sign in, then join from this page.");
    user = await prisma.user.create({ data: { name: input.name, email, phone: input.phone ?? null, passwordHash: await hashPassword(input.password) } });
    newAccount = true;
  }

  const phone = input.phone ?? user.phone ?? null;
  const email = user.email ?? input.email?.toLowerCase() ?? null;
  const [referrer, promo, duplicate] = await Promise.all([
    referrerByCode(db, input.ref),
    livePromotion(db, input.promo),
    phone || email
      ? db.member.findFirst({ where: { archivedAt: null, userId: null, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])] }, select: { memberCode: true } })
      : null,
  ]);
  let member;
  try {
    member = await createMemberRecord(db, {
      gymId: gym.id, fullName: input.name || user.name, phone, email, joinedOn: todayIn(gym.timezone), source: "SELF_SIGNUP", userId: user.id,
      referredById: referrer?.id ?? null, promotionId: promo?.id ?? null,
      notes: duplicate ? `Joined online. Possible duplicate of ${duplicate.memberCode} — check before adding a membership.` : "Joined online.",
    });
  } catch (err) {
    // Don't leave an account behind that belongs to no gym because the member row failed.
    if (newAccount) await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    throw err;
  }

  // A matching open enquiry gets a note for staff to confirm. The contact details typed here are unverified, so
  // they never close someone's enquiry on their own.
  const contact = [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])];
  if (contact.length) {
    const lead = await db.lead.findFirst({ where: { ...OPEN_LEAD, OR: contact }, orderBy: { createdAt: "desc" } });
    if (lead) await db.lead.update({ where: { id: lead.id }, data: { notes: [lead.notes, `Someone with this contact joined online as ${member.memberCode}. Check it's them, then mark Joined.`].filter(Boolean).join("\n").slice(-2000) } });
  }

  await notifyStaff(gym.id, ["OWNER", "MANAGER", "STAFF"], {
    channel: "IN_APP",
    category: "GROWTH",
    title: `${member.fullName} joined online`,
    body: `${member.fullName} (${member.memberCode}) signed up from your public page${referrer ? `, referred by ${referrer.fullName}` : ""}${promo ? `, via "${promo.title}"` : ""}.${duplicate ? ` They may already be on file as ${duplicate.memberCode}.` : ""}`,
    link: `/app/members/${member.id}`,
  });
  await audit({ actor: { type: "USER", id: user.id, name: user.name, role: "MEMBER", ...meta }, action: "members.self_signup", entityType: "Member", entityId: member.id, gymId: gym.id, after: { referredById: referrer?.id, promotionId: promo?.id, newAccount } });

  const plan = input.planId ? await db.membershipPlan.findFirst({ where: { id: input.planId, active: true }, select: { id: true } }) : null;
  const planId = plan?.id ?? (await db.gymPromotion.findFirst({ where: { id: promo?.id ?? "" }, select: { planId: true } }))?.planId ?? null;
  const coupon = promo?.coupon?.active ? promo.coupon.code : null;
  const qs = new URLSearchParams({ welcome: "1", ...(planId ? { plan: planId } : {}), ...(coupon ? { coupon } : {}) });
  return { userId: user.id, memberId: member.id, newAccount, redirect: `/app/renew?${qs}` };
}

// ─────────────────────────────── Numbers for the Grow page ───────────────────────────────

export async function growthStats(gymId: string, days = 30) {
  const db = tenantDb(gymId);
  const since = daysAgo(days);
  const [leads, converted, selfSignups, referred, topReferrers, byPromo] = await Promise.all([
    db.lead.count({ where: { createdAt: { gte: since } } }),
    db.lead.count({ where: { createdAt: { gte: since }, status: "CONVERTED" } }),
    db.member.count({ where: { createdAt: { gte: since }, source: "SELF_SIGNUP" } }),
    db.member.count({ where: { createdAt: { gte: since }, referredById: { not: null } } }),
    db.member.groupBy({ by: ["referredById"], where: { referredById: { not: null } }, _count: { _all: true }, orderBy: { _count: { referredById: "desc" } }, take: 5 }),
    db.member.groupBy({ by: ["promotionId"], where: { promotionId: { not: null } }, _count: { _all: true } }),
  ]);
  const names = await db.member.findMany({ where: { id: { in: topReferrers.map((r) => r.referredById!) } }, select: { id: true, fullName: true, memberCode: true } });
  return {
    days,
    leads,
    converted,
    conversionPct: leads ? Math.round((converted / leads) * 100) : null,
    selfSignups,
    referred,
    topReferrers: topReferrers.map((r) => ({ member: names.find((n) => n.id === r.referredById) ?? null, count: r._count._all })),
    joinsByPromotion: Object.fromEntries(byPromo.map((p) => [p.promotionId!, p._count._all])),
  };
}
