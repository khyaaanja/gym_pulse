import Link from "next/link";
import { requireAdmin } from "@/lib/page-auth";
import { platformOverview, rangeFor } from "@/services/analytics";
import { prisma } from "@/db/client";
import { formatMoneyCompact } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { PageHeader, EstimateNote } from "@/components/ui/misc";
import { RangeTabs } from "@/components/app/range-tabs";
import { MagnitudeBars } from "@/components/app/charts";

export default async function Overview({ searchParams }: PageProps<"/super-admin">) {
  await requireAdmin("analytics.view");
  const { range = "30d" } = await searchParams;
  const r = ["today", "7d", "30d", "90d"].includes(String(range)) ? String(range) : "30d";
  const o = await platformOverview(rangeFor(r, "Asia/Kathmandu"));
  const period = r === "today" ? "Today" : `Last ${o.range.days} days`;
  const newByDay = await prisma.$queryRaw<{ d: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt") AS d, COUNT(*) AS n FROM "Gym" WHERE "createdAt" >= now() - interval '12 weeks' GROUP BY 1 ORDER BY 1`;
  return (
    <>
      <PageHeader title="GymPulse Platform" description="Revenue, growth, retention, risk, marketplace and system health." actions={<RangeTabs current={r} base="/super-admin" />} />
      <h2 className="mb-3 text-sm font-medium text-ink-3">Revenue</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="SaaS MRR" value={formatMoneyCompact(o.actual.saasMrrPaisa)} period="Now" definition="Sum of active and past-due subscriptions, monthly equivalent." />
        <Metric label="ARR" value={formatMoneyCompact(o.actual.saasArrPaisa)} period="Now" definition="MRR × 12." />
        <Metric label="Marketplace GMV" value={formatMoneyCompact(o.actual.marketplaceGmvPaisa)} period={period} definition="Paid marketplace orders across all gyms (gross)." />
        <Metric label="Platform commissions" value={formatMoneyCompact(o.actual.platformCommissionPaisa)} period={period} definition="Ledger entries for platform commission." />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-medium text-ink-3">Growth & retention</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total gyms" value={o.gyms.total} period={`${o.gyms.active} active · ${o.gyms.trial} trial · ${o.gyms.suspended} suspended`} href="/super-admin/gyms" />
        <Metric label="New gyms" value={o.gyms.newInPeriod} period={period} />
        <Metric label="Gym churn" value={o.gyms.churnedInPeriod} period={period} definition="Gyms archived in the period." />
        <Metric label="Members" value={o.members.total.toLocaleString("en-IN")} period={`${o.members.active.toLocaleString("en-IN")} active`} />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-medium text-ink-3">Risk</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="At-risk members" value={o.members.atRisk} period="Today" definition="Active membership, 10+ days without a visit (per each gym's threshold)." />
        <Metric label="Revenue at risk" value={formatMoneyCompact(o.actual.revenueAtRiskPaisa)} period="Monthly fees, today" />
        <Metric label="Estimated churn (30d)" estimate value={o.estimated.memberLoss.estimate === null ? "—" : `${o.estimated.memberLoss.low}–${o.estimated.memberLoss.high}`} period="Sum of each gym's latest estimate" />
        <Metric label="Revenue protected" estimate value={formatMoneyCompact(o.estimated.revenueProtectedPaisa)} period={period} />
      </div>
      <div className="grid-cols-1 mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="System health" action={<Link href="/super-admin/system" className="text-sm text-brand">Details</Link>} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-mist p-4"><dt className="text-ink-3">Dead-lettered jobs</dt><dd className={`num text-2xl font-semibold ${o.system.deadJobs ? "text-risk" : ""}`}>{o.system.deadJobs}</dd></div>
              <div className="rounded-2xl bg-mist p-4"><dt className="text-ink-3">Queue lag</dt><dd className="num text-2xl font-semibold">{o.system.queueLagSeconds}s</dd></div>
              <div className="rounded-2xl bg-mist p-4"><dt className="text-ink-3">Payment failures</dt><dd className="num text-2xl font-semibold">{o.actual.paymentFailures}</dd></div>
              <div className="rounded-2xl bg-mist p-4"><dt className="text-ink-3">Rejected webhooks</dt><dd className={`num text-2xl font-semibold ${o.system.webhookFailures ? "text-risk" : ""}`}>{o.system.webhookFailures}</dd></div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New gyms per week" description="Last 12 weeks" />
          <CardBody><MagnitudeBars unit="gyms" data={newByDay.map((w) => ({ label: w.d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: Number(w.n) }))} /></CardBody>
        </Card>
      </div>
      <EstimateNote className="mt-6">Metrics marked Estimate come from each gym&apos;s risk model and recovery assumptions; everything else is recorded data.</EstimateNote>
    </>
  );
}
