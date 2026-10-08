import { z } from "zod";
import { prisma } from "@/db/client";
import type { GymContext } from "@/lib/api";
import { badRequest } from "@/lib/errors";

const date = z.string().datetime().nullable().optional();

export const promotionSchema = z.object({
  title: z.string().trim().min(3, "Give the offer a headline.").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  badge: z.string().trim().max(24).nullable().optional(),
  couponId: z.string().max(40).nullable().optional(),
  planId: z.string().max(40).nullable().optional(),
  startsAt: date,
  endsAt: date,
  active: z.boolean().optional(),
  showOnPublicPage: z.boolean().optional(),
});

/** Coupon and plan must belong to this gym: an id from another gym is refused, never linked. */
export async function promotionData(ctx: GymContext, b: Partial<z.infer<typeof promotionSchema>>) {
  if (b.couponId && !(await prisma.coupon.findFirst({ where: { id: b.couponId, gymId: ctx.gym.id }, select: { id: true } }))) throw badRequest("Choose one of your gym's coupons.");
  if (b.planId && !(await ctx.db.membershipPlan.findFirst({ where: { id: b.planId }, select: { id: true } }))) throw badRequest("Choose one of your gym's plans.");
  const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
  const startsAt = toDate(b.startsAt);
  const endsAt = toDate(b.endsAt);
  if (startsAt && endsAt && endsAt <= startsAt) throw badRequest("The offer must end after it starts.");
  // Only the keys that were sent, so an edit never clears what it didn't mention.
  const out: Record<string, unknown> = { ...b, startsAt, endsAt };
  if ("couponId" in b) out.couponId = b.couponId || null;
  if ("planId" in b) out.planId = b.planId || null;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Omit<Partial<z.infer<typeof promotionSchema>>, "startsAt" | "endsAt"> & { startsAt?: Date | null; endsAt?: Date | null };
}
