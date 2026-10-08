import { prisma } from "@/db/client";
import type { LedgerAccount } from "@/generated/prisma/client";

export type FinanceMonth = { month: string; saas: number; commission: number; vendorPayable: number; marketplaceGross: number; membership: number };

/**
 * Platform money over the last `months` calendar months (Nepal time), straight from the ledger —
 * the same append-only entries the CSV exports read. MRR counts paying subscriptions only
 * (trials excluded), with yearly plans spread over 12 months.
 */
export async function platformFinance(months = 6) {
  // Month boundaries in Nepal time (UTC+05:45, no DST).
  const OFFSET = 345 * 60_000;
  const local = new Date(Date.now() + OFFSET);
  const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1), 1);
  const start = new Date(first - OFFSET);
  const [rows, subs, topGyms] = await Promise.all([
    prisma.$queryRaw<{ month: string; account: LedgerAccount; total: bigint }[]>`
      SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'Asia/Kathmandu'), 'YYYY-MM') AS month, "account", SUM("amountPaisa")::bigint AS total
      FROM "LedgerEntry" WHERE "createdAt" >= ${start}
      GROUP BY 1, 2`,
    prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } }, include: { plan: { select: { pricePaisa: true, billingPeriod: true } } } }),
    prisma.$queryRaw<{ gymId: string; total: bigint }[]>`
      SELECT "gymId", SUM("amountPaisa")::bigint AS total FROM "LedgerEntry"
      WHERE "createdAt" >= now() - interval '30 days' AND "account" IN ('MEMBERSHIP_REVENUE', 'DISCOUNT', 'MARKETPLACE_GROSS') AND "gymId" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
  ]);
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + i);
    keys.push(d.toISOString().slice(0, 7));
  }
  const sum = (m: string, a: LedgerAccount) => Number(rows.find((r) => r.month === m && r.account === a)?.total ?? 0);
  const series: FinanceMonth[] = keys.map((m) => ({
    month: m,
    saas: sum(m, "SAAS_REVENUE"),
    commission: sum(m, "PLATFORM_COMMISSION"),
    vendorPayable: sum(m, "VENDOR_PAYABLE"),
    marketplaceGross: sum(m, "MARKETPLACE_GROSS"),
    // Membership revenue is booked gross; the DISCOUNT contra line brings it back to cash taken.
    membership: sum(m, "MEMBERSHIP_REVENUE") + sum(m, "DISCOUNT"),
  }));
  const mrr = subs.reduce((a, s) => a + (s.plan.billingPeriod === "YEARLY" ? Math.round(s.plan.pricePaisa / 12) : s.plan.pricePaisa), 0);
  const gyms = await prisma.gym.findMany({ where: { id: { in: topGyms.map((g) => g.gymId) } }, select: { id: true, name: true } });
  return {
    series,
    mrr,
    payingGyms: subs.length,
    topGyms: topGyms.map((g) => ({ id: g.gymId, name: gyms.find((x) => x.id === g.gymId)?.name ?? "—", total: Number(g.total) })),
  };
}
