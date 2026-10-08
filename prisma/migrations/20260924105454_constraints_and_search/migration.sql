-- Only one open recovery task per member (closed tasks are history).
CREATE UNIQUE INDEX "RecoveryTask_one_open_per_member" ON "RecoveryTask" ("memberId") WHERE "closedAt" IS NULL;

-- Fast fuzzy member search by name / phone / code.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Member_fullName_trgm" ON "Member" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX "Member_memberCode_trgm" ON "Member" USING gin ("memberCode" gin_trgm_ops);

-- Money columns can never be negative where a negative value is meaningless.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonneg" CHECK ("amountPaisa" >= 0);
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_price_nonneg" CHECK ("pricePaisa" >= 0 AND "durationDays" > 0);
ALTER TABLE "MarketplaceProduct" ADD CONSTRAINT "Product_inventory_nonneg" CHECK ("inventory" IS NULL OR "inventory" >= 0);
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_bps_valid" CHECK ("platformBps" >= 0 AND "gymBps" >= 0 AND "vendorBps" >= 0 AND "platformBps" + "gymBps" + "vendorBps" = 10000);
