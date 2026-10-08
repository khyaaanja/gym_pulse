import { prisma, type Tx } from "@/db/client";
import { badRequest } from "@/lib/errors";
import { applyBps } from "@/lib/money";
import type { CouponScope } from "@/generated/prisma/enums";

/**
 * Validates a coupon for this gym + member and returns the discount. Gym coupons win over platform coupons with the same code.
 * This is a quote only: limits are enforced when the coupon is reserved (`reserveCoupon`), inside the checkout transaction.
 */
export async function applyCoupon(gymId: string, memberId: string, code: string, scope: Exclude<CouponScope, "ALL">, amountPaisa: number) {
  const normalized = code.trim().toUpperCase();
  const candidates = await prisma.coupon.findMany({ where: { code: normalized, active: true, OR: [{ gymId }, { gymId: null }] } });
  const coupon = candidates.find((c) => c.gymId === gymId) ?? candidates.find((c) => c.gymId === null);
  const now = new Date();
  if (!coupon) throw badRequest("That coupon code isn't valid.");
  if (coupon.appliesTo !== "ALL" && coupon.appliesTo !== scope) throw badRequest("That coupon can't be used here.");
  if (coupon.validFrom && coupon.validFrom > now) throw badRequest("That coupon isn't active yet.");
  if (coupon.validUntil && coupon.validUntil < now) throw badRequest("That coupon has expired.");
  await assertCouponLimits(prisma, coupon, memberId);
  const discount = coupon.kind === "PERCENT" ? applyBps(amountPaisa, Math.min(coupon.value, 10_000)) : Math.min(coupon.value, amountPaisa);
  return { couponId: coupon.id, code: coupon.code, discountPaisa: discount };
}

/** Live redemptions (reservations for open checkouts plus completed uses) count against both limits. */
async function assertCouponLimits(db: Tx | typeof prisma, coupon: { id: string; maxRedemptions: number | null; perMemberLimit: number }, memberId: string) {
  const [total, mine] = await Promise.all([
    db.couponRedemption.count({ where: { couponId: coupon.id } }),
    db.couponRedemption.count({ where: { couponId: coupon.id, memberId } }),
  ]);
  if (coupon.maxRedemptions !== null && total >= coupon.maxRedemptions) throw badRequest("That coupon has been fully used.");
  if (mine >= coupon.perMemberLimit) throw badRequest("You've already used this coupon.");
}

/**
 * Reserves one use of a coupon for a checkout. Runs inside the checkout transaction and locks the coupon row, so two
 * checkouts can't both pass the limit check. Pass the payment (membership) or the order (marketplace) it belongs to.
 */
export async function reserveCoupon(tx: Tx, couponId: string, memberId: string, owner: { paymentId: string } | { orderId: string }) {
  const [coupon] = await tx.$queryRaw<{ id: string; maxRedemptions: number | null; perMemberLimit: number }[]>`
    SELECT "id", "maxRedemptions", "perMemberLimit" FROM "Coupon" WHERE "id" = ${couponId} FOR UPDATE`;
  if (!coupon) throw badRequest("That coupon code isn't valid.");
  await assertCouponLimits(tx, coupon, memberId);
  await tx.couponRedemption.create({ data: { couponId, memberId, ...owner } });
}

/** Gives a reserved use back when its payment fails or its order is cancelled. Completed uses are never released. */
export async function releaseCouponReservation(tx: Tx | typeof prisma, owner: { paymentId: string } | { orderId: string }) {
  await tx.couponRedemption.deleteMany({ where: owner });
}

/**
 * Called inside the payment-confirmation transaction. Links the reservation to the payment (creating it if the
 * reservation was released, e.g. a payment that succeeded after being timed out) and bumps the display counter.
 */
export async function recordCouponRedemption(tx: Tx, couponId: string, memberId: string, paymentId: string, orderId?: string | null) {
  const reserved = await tx.couponRedemption.findFirst({ where: orderId ? { OR: [{ paymentId }, { orderId }] } : { paymentId } });
  if (reserved) {
    if (reserved.paymentId !== paymentId) await tx.couponRedemption.update({ where: { id: reserved.id }, data: { paymentId } });
  } else {
    // Payment already captured; honour it but record if it took the coupon past a limit.
    const [total, mine] = await Promise.all([tx.couponRedemption.count({ where: { couponId } }), tx.couponRedemption.count({ where: { couponId, memberId } })]);
    const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: couponId } });
    if ((coupon.maxRedemptions !== null && total >= coupon.maxRedemptions) || mine >= coupon.perMemberLimit) {
      await tx.auditLog.create({ data: { actorType: "SYSTEM", action: "coupon.cap_exceeded", entityType: "Coupon", entityId: couponId, gymId: coupon.gymId, metadata: { paymentId } } });
    }
    await tx.couponRedemption.create({ data: { couponId, memberId, paymentId, orderId: orderId ?? null } });
  }
  await tx.coupon.update({ where: { id: couponId }, data: { redemptions: { increment: 1 } } });
}
