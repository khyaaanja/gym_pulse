-- Membership payments with a discount used to book MEMBERSHIP_REVENUE net of the discount *and* a negative
-- DISCOUNT line, so revenue + discount came to cash − discount. New payments book revenue gross. The ledger is
-- append-only, so each affected payment gets one correcting +discount MEMBERSHIP_REVENUE entry, dated with the
-- original so monthly totals land in the right month. Idempotent: only payments whose revenue still sums to the
-- cash amount are touched.
INSERT INTO "LedgerEntry" ("id", "gymId", "paymentId", "account", "amountPaisa", "description", "createdAt")
SELECT gen_random_uuid()::text, p."gymId", p."id", 'MEMBERSHIP_REVENUE', p."discountPaisa",
       'Correction: revenue booked gross of discount', rev."createdAt"
FROM "Payment" p
JOIN LATERAL (
  SELECT SUM(r."amountPaisa") AS total, MIN(r."createdAt") AS "createdAt"
  FROM "LedgerEntry" r WHERE r."paymentId" = p."id" AND r."account" = 'MEMBERSHIP_REVENUE'
) rev ON TRUE
WHERE p."purpose" = 'MEMBERSHIP'
  AND p."discountPaisa" > 0
  AND rev.total = p."amountPaisa"
  AND EXISTS (SELECT 1 FROM "LedgerEntry" d
              WHERE d."paymentId" = p."id" AND d."account" = 'DISCOUNT' AND d."amountPaisa" = -p."discountPaisa");
