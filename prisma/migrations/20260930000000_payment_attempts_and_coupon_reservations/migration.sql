-- Marketplace orders keep one Payment row per checkout attempt, so a paid earlier attempt can still be matched.
DROP INDEX "Payment_orderId_key";
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- Desk payments carry a client idempotency key; resubmitting the same form returns the first payment.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Payment_gymId_idempotencyKey_key" ON "Payment"("gymId", "idempotencyKey");

-- Coupon redemptions become reservations taken at checkout: tied to a payment (membership) or an order (marketplace).
ALTER TABLE "CouponRedemption" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "CouponRedemption" ADD COLUMN "orderId" TEXT;
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
