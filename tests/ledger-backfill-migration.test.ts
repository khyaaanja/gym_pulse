import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { makeGym, makeMember } from "./helpers/fixtures";
import { sumLedger } from "./helpers/money";

// The global setup applies every migration to an empty schema, so the backfill's data path only runs here,
// against rows shaped the way the old code wrote them.
const SQL = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261008000000_ledger_gross_membership_revenue/migration.sql"), "utf8");
const runBackfill = () => prisma.$executeRawUnsafe(SQL);

let ref = 0;
const LEGACY_AT = new Date("2026-03-15T06:00:00Z");

async function payment(gymId: string, memberId: string, o: { amount: number; discount: number; purpose?: "MEMBERSHIP" | "MARKETPLACE_ORDER" }, ledger: { revenue?: number; discount?: number }) {
  const p = await prisma.payment.create({
    data: { gymId, memberId, purpose: o.purpose ?? "MEMBERSHIP", method: "CASH", reference: `BACKFILL-${Date.now()}-${ref++}`, amountPaisa: o.amount, discountPaisa: o.discount, status: "SUCCEEDED", paidAt: LEGACY_AT, createdAt: LEGACY_AT },
  });
  const rows = [
    ...(ledger.revenue !== undefined ? [{ account: "MEMBERSHIP_REVENUE" as const, amountPaisa: ledger.revenue, description: "Monthly membership" }] : []),
    ...(ledger.discount !== undefined ? [{ account: "DISCOUNT" as const, amountPaisa: ledger.discount, description: "Coupon discount" }] : []),
  ];
  await prisma.ledgerEntry.createMany({ data: rows.map((r) => ({ ...r, gymId, paymentId: p.id, createdAt: LEGACY_AT })) });
  return p;
}

const net = async (paymentId: string) => (await sumLedger({ paymentId }, "MEMBERSHIP_REVENUE")) + (await sumLedger({ paymentId }, "DISCOUNT"));

describe("migration 20261008000000_ledger_gross_membership_revenue", () => {
  it("grosses up only legacy discounted membership payments, append-only, dated with the original, and is idempotent", async () => {
    const { gym } = await makeGym();
    const m = await makeMember(gym.id);

    // Old shape: revenue booked net AND a negative DISCOUNT line → net = cash − discount. The one to fix.
    const legacy = await payment(gym.id, m.id, { amount: 100_000, discount: 50_000 }, { revenue: 100_000, discount: -50_000 });
    // New shape (already gross) — must not be touched.
    const current = await payment(gym.id, m.id, { amount: 100_000, discount: 50_000 }, { revenue: 150_000, discount: -50_000 });
    // No discount at all.
    const plain = await payment(gym.id, m.id, { amount: 150_000, discount: 0 }, { revenue: 150_000 });
    // Discount on the payment but no DISCOUNT line: its ledger already nets to cash, so leave it.
    const noContra = await payment(gym.id, m.id, { amount: 100_000, discount: 50_000 }, { revenue: 100_000 });
    // Not a membership payment.
    const other = await payment(gym.id, m.id, { amount: 100_000, discount: 50_000, purpose: "MARKETPLACE_ORDER" }, { revenue: 100_000, discount: -50_000 });

    const before = await prisma.ledgerEntry.findMany({ where: { gymId: gym.id }, orderBy: { id: "asc" } });
    expect(await net(legacy.id)).toBe(50_000); // the bug, as stored

    await runBackfill();

    // The legacy payment now nets to the cash taken, via exactly one new correcting entry.
    expect(await net(legacy.id)).toBe(legacy.amountPaisa);
    expect(await sumLedger({ paymentId: legacy.id }, "MEMBERSHIP_REVENUE")).toBe(150_000);
    const corrections = await prisma.ledgerEntry.findMany({ where: { paymentId: legacy.id, description: "Correction: revenue booked gross of discount" } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ gymId: gym.id, account: "MEMBERSHIP_REVENUE", amountPaisa: 50_000, orderId: null, vendorId: null });
    expect(corrections[0]!.createdAt.toISOString()).toBe(LEGACY_AT.toISOString());

    // Append-only: every pre-existing row is unchanged, and the only new row is the correction.
    const after = await prisma.ledgerEntry.findMany({ where: { gymId: gym.id }, orderBy: { id: "asc" } });
    for (const row of before) expect(after.find((a) => a.id === row.id)).toEqual(row);
    expect(after.filter((a) => !before.some((b) => b.id === a.id)).map((a) => a.id)).toEqual([corrections[0]!.id]);

    // Nothing else moved.
    expect(await net(current.id)).toBe(current.amountPaisa);
    expect(await net(plain.id)).toBe(plain.amountPaisa);
    expect(await net(noContra.id)).toBe(noContra.amountPaisa);
    expect(await net(other.id)).toBe(50_000);

    // Idempotent: a second run inserts nothing anywhere in the schema.
    expect(await runBackfill()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { gymId: gym.id } })).toBe(after.length);
  });
});
