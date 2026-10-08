import { prisma } from "@/db/client";
import type { Prisma, User } from "@/generated/prisma/client";
import { audit, type AuditActor } from "@/lib/audit";
import { badRequest, conflict } from "@/lib/errors";
import { addMonths } from "date-fns";
import { hashPassword } from "@/lib/auth/password";
import { slugify } from "@/lib/utils";
import { randomToken } from "@/lib/crypto";

async function uniqueSlug(name: string) {
  const base = slugify(name) || "gym";
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.gym.findUnique({ where: { slug } }))) return slug;
  }
  return `${base}-${randomToken(3).toLowerCase()}`;
}

async function setting<T>(key: string, fallback: T): Promise<T> {
  const s = await prisma.platformSetting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}

/** When a new gym's free period ends: the plan's free months if it offers any, else the platform trial length. */
export function trialEndFor(plan: { freeMonths: number } | null, trialDays: number, from = new Date()): Date {
  return plan && plan.freeMonths > 0 ? addMonths(from, plan.freeMonths) : new Date(from.getTime() + trialDays * 86_400_000);
}

/** The plan a self-serve signup gets: `planKey` must be a plan shown on the pricing page (public + active), so a hidden
 *  or retired plan (or its free months) can't be claimed by editing the link; otherwise the platform default. */
async function signupPlan(planKey?: string) {
  let key = await setting("platform.defaultPlan", "starter");
  if (planKey) {
    const chosen = await prisma.saasPlan.findFirst({ where: { key: planKey, isPublic: true, active: true }, select: { key: true } });
    if (!chosen) throw badRequest("That plan isn't available. Choose one from the pricing page.");
    key = chosen.key;
  }
  const [plan, trialDays] = await Promise.all([prisma.saasPlan.findUnique({ where: { key } }), setting("platform.trialDays", 14)]);
  return { key, plan, trialEnd: trialEndFor(plan, trialDays) };
}

type NewGym = { gymName: string; city?: string; email: string; phone?: string | null; planKey?: string };

/** The gym, its owner seat, main location and trialing subscription, for a user created in the same transaction or already existing. */
async function createTrialGym(input: NewGym, owner: (tx: Prisma.TransactionClient) => Promise<User>, actor?: AuditActor) {
  const { key: planKey, plan, trialEnd } = await signupPlan(input.planKey);
  const slug = await uniqueSlug(input.gymName);
  const result = await prisma.$transaction(async (tx) => {
    const gym = await tx.gym.create({ data: { name: input.gymName, slug, city: input.city, email: input.email, phone: input.phone, status: "TRIAL", planId: plan?.id, trialEndsAt: trialEnd } });
    const user = await owner(tx);
    await tx.staffMember.create({ data: { gymId: gym.id, userId: user.id, role: "OWNER", title: "Owner" } });
    await tx.location.create({ data: { gymId: gym.id, name: input.city ? `${input.city} (main)` : "Main", isPrimary: true } });
    if (plan) await tx.subscription.create({ data: { gymId: gym.id, planId: plan.id, status: "TRIALING", currentPeriodStart: new Date(), currentPeriodEnd: trialEnd } });
    return { gym, user };
  });
  await audit({ actor: actor ?? { type: "USER", id: result.user.id, name: result.user.name, role: "OWNER" }, action: "gyms.created", entityType: "Gym", entityId: result.gym.id, gymId: result.gym.id, after: { name: result.gym.name, slug, plan: planKey, trialEndsAt: trialEnd } });
  return result;
}

/** Self-serve signup: a gym on trial with its owner account and a trialing subscription. */
export async function createGymWithOwner(input: { gymName: string; city?: string; ownerName: string; email: string; phone?: string | null; password: string; planKey?: string }, actor?: AuditActor) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict("An account with this email already exists. Sign in instead.");
  if (input.phone && (await prisma.user.findUnique({ where: { phone: input.phone } }))) throw conflict("An account with this phone number already exists.");
  const passwordHash = await hashPassword(input.password);
  return createTrialGym({ ...input, email }, (tx) => tx.user.create({ data: { name: input.ownerName, email, phone: input.phone ?? null, passwordHash } }), actor);
}

/**
 * Signup for someone already signed in (e.g. just created by "Continue with Google"): the gym is created around the
 * existing account, so there is no password or email to collect. One self-serve gym per account: anyone who already
 * owns a gym is refused, so a single session can't mint trial gyms in a loop.
 */
export async function createGymForUser(userId: string, input: { gymName: string; city?: string; phone?: string | null; planKey?: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.email) throw badRequest("Add an email to your account before creating a gym.");
  const owns = (db: Prisma.TransactionClient | typeof prisma) => db.staffMember.findFirst({ where: { userId, role: "OWNER" }, select: { id: true } });
  const already = () => conflict("You already own a gym on GymPulse. Contact support to add another.");
  if (await owns(prisma)) throw already();
  return createTrialGym({ ...input, email: user.email }, async (tx) => {
    // Nothing in the schema enforces one owned gym per account, so concurrent requests are serialised on the user row
    // and the check is repeated inside the transaction, where it sees any seat a racing request has committed.
    await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (await owns(tx)) throw already();
    return user;
  });
}
