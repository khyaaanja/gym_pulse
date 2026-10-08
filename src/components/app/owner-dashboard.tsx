import Link from "next/link";
import { GymScene } from "@/components/three/gym-scene";
import { AlertTriangle, CalendarClock, CreditCard, FileWarning, PackageCheck, PhoneCall, Upload } from "lucide-react";
import type { GymContext } from "@/lib/api";
import { actionCenter, gymDashboard, rangeFor } from "@/services/analytics";
import { formatMoney } from "@/lib/money";
import { formatDate, fromDbDate, diffDays, today as todayIn, localDate, localHour } from "@/lib/time";
import { predictionConfigFor } from "@/config/prediction";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { Button } from "@/components/ui/button";
import { EstimateNote, PageHeader } from "@/components/ui/misc";
import { AttendanceChart, MagnitudeBars } from "./charts-lazy";
import { StatusBar } from "./status-bar";
import { RangeTabs } from "./range-tabs";

const CONF: Record<string, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", INSUFFICIENT: "Not enough data" };

export async function OwnerDashboard({ ctx, range }: { ctx: GymContext; range: string }) {
  const r = rangeFor(range, ctx.gym.timezone);
  const [d, ac, cfg] = await Promise.all([gymDashboard(ctx.gym, r), actionCenter(ctx.gym), predictionConfigFor(ctx.gym.id)]);
  const sym = ctx.gym.currencySymbol;
  const a = d.actual;
  const report = d.estimated.report;
  const period = range === "today" ? "Today" : `Last ${r.days} days`;
  const today = todayIn(ctx.gym.timezone);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

  const actions = [
    ...ac.critical.map((m) => ({ key: `c-${m.id}`, icon: AlertTriangle, tone: "text-risk", title: m.fullName, detail: `Critical attention · ${m.lastAttendanceAt ? `last visit ${diffDays(localDate(m.lastAttendanceAt, ctx.gym.timezone), today)} days ago` : "no visits recorded"}`, href: `/app/members/${m.id}` })),
    ...(ac.inactiveCount ? [{ key: "inactive", icon: PhoneCall, tone: "text-risk", title: `${ac.inactiveCount} members inactive ${cfg.inactivityThresholdDays}+ days`, detail: "Open Pulse to contact them", href: "/app/pulse" }] : []),
    ...ac.expiring.slice(0, 5).map((m) => ({ key: `e-${m.id}`, icon: CalendarClock, tone: "text-warn", title: `${m.member.fullName}'s ${m.plan.name} expires ${formatDate(fromDbDate(m.endDate), { day: "numeric", month: "short" })}`, detail: ((n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`))(diffDays(today, fromDbDate(m.endDate))), href: `/app/members/${m.member.id}` })),
    ...ac.failedPayments.slice(0, 3).map((p) => ({ key: `p-${p.id}`, icon: CreditCard, tone: "text-risk", title: p.member?.fullName ?? "Unknown member", detail: `Payment failed · ${formatMoney(p.amountPaisa, sym)}`, href: "/app/renew" })),
    ...ac.followUps.slice(0, 5).map((t) => ({ key: `f-${t.id}`, icon: PhoneCall, tone: "text-brand", title: `Follow up with ${t.member.fullName}`, detail: t.status === "NOT_CONTACTED" ? "Not contacted yet" : "Follow-up due", href: `/app/members/${t.member.id}` })),
    ...(ac.pendingOrders ? [{ key: "orders", icon: PackageCheck, tone: "text-brand", title: `${ac.pendingOrders} paid orders to fulfil`, detail: "Marketplace", href: "/app/marketplace?tab=orders" }] : []),
    ...(ac.pendingBookings ? [{ key: "bookings", icon: PackageCheck, tone: "text-brand", title: `${ac.pendingBookings} bookings to schedule`, detail: "Trainers", href: "/app/bookings" }] : []),
    ...ac.importIssues.map((j) => ({ key: `i-${j.id}`, icon: FileWarning, tone: "text-warn", title: `${j.file.originalName} ${j.status === "FAILED" ? "couldn't be processed" : "needs review"}`, detail: "Analyze Records", href: `/app/imports/${j.id}` })),
  ];

  return (
    <>
      <PageHeader title={`Good ${localHour(new Date(), ctx.gym.timezone) < 12 ? "morning" : localHour(new Date(), ctx.gym.timezone) < 17 ? "afternoon" : "evening"}, ${ctx.user.name.split(" ")[0]}`} description={`${ctx.gym.name} at a glance.`} actions={<RangeTabs current={range} base="/app" />} />

      <div className="grid-cols-1 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/app/pulse" className="bg-dusk group relative isolate overflow-hidden rounded-[var(--radius-card)] p-6 text-white shadow-lift ring-1 ring-white/5 transition-transform duration-200 hover:-translate-y-0.5 sm:col-span-2 lg:col-span-1 lg:row-span-2">
          <GymScene mode="panel" priority className="absolute inset-0 -z-10 opacity-90" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(10_8_18/0.7)_0%,rgb(10_8_18/0.1)_45%,rgb(10_8_18/0.85)_100%)]" />
          <p className="text-[15px] opacity-80">Revenue at risk</p>
          <p className="display num mt-2 text-5xl font-extrabold leading-none xl:text-6xl">{formatMoney(a.revenueAtRiskPaisa, sym)}</p>
          <p className="mt-3 text-sm opacity-75">{a.atRiskMembers} members with active memberships haven&apos;t visited in {cfg.inactivityThresholdDays}+ days. Monthly fees, today.</p>
          <div className="mt-6 border-t border-white/15 pt-5">
            <p className="text-sm opacity-80">Estimated members at risk</p>
            {report && report.confidence !== "INSUFFICIENT" ? (
              <>
                <p className="display num mt-1 text-3xl font-bold">{report.rangeLow}–{report.rangeHigh}</p>
                <p className="mt-1 text-xs opacity-70">Estimate · confidence {CONF[report.confidence]} · {formatDate(report.generatedAt)}</p>
              </>
            ) : (
              <p className="mt-1 text-sm opacity-80">{report ? "Not enough data for a reliable estimate yet." : "No estimate yet."}</p>
            )}
          </div>
          <span className="mt-6 inline-block text-sm font-medium underline underline-offset-4">Who should we call today?</span>
        </Link>
        <Metric label="Revenue protected" estimate value={formatMoney(d.estimated.revenueProtectedPaisa, sym)} period={period} definition={`Monthly fee × assumed ${cfg.protectedRevenueMonths} months for at-risk members who renewed after staff contacted them. Estimated, separate from payments received.`} />
        <Metric label="Active members" value={a.activeMembers} period="Today" definition="Members holding an active membership today." href="/app/members" />
        <Metric label="Renewal rate" value={pct(a.renewal.rate)} period={period} definition={`Renewed ÷ memberships that ended in the period (${a.renewal.renewed}/${a.renewal.expired}). Memberships still in their grace period aren't counted yet.`} />
        <Metric label="Marketplace revenue" value={formatMoney(a.marketplaceRevenuePaisa, sym)} period={period} definition="Paid marketplace orders (gross)." href="/app/marketplace" />
      </div>

      <div className="grid-cols-1 mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Action center" description="What needs attention, most urgent first." />
          <CardBody>
            {actions.length === 0 ? (
              <p className="text-sm text-ink-3">Nothing needs attention right now.</p>
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {actions.slice(0, 12).map((x) => (
                  <li key={x.key}>
                    <Link href={x.href} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-2">
                      <x.icon className={`size-5 shrink-0 ${x.tone}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{x.title}</span>
                        <span className="block truncate text-sm text-ink-3">{x.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {ctx.flags.file_import && ctx.can("imports.create") && (
            <Card className="bg-brand-soft ring-brand/20">
              <CardBody>
                <Upload className="size-6 text-brand" aria-hidden />
                <h2 className="display mt-3 text-xl font-semibold">Analyze existing records</h2>
                <p className="mt-1 text-sm text-ink-2">Upload your attendance or membership records and get an estimated view of members who may be at risk.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild><Link href="/app/imports/new">Upload records</Link></Button>
                  {report && report.confidence !== "INSUFFICIENT" && <Button asChild variant="secondary"><Link href={`/app/forecast/${report.id}`}>View risk report</Link></Button>}
                </div>
                {report && report.highRiskCount > 0 && <p className="mt-3 text-sm font-medium text-brand">{report.highRiskCount} members may need attention.</p>}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Member retention" description="Everyone with a membership, by status today." />
            <CardBody><StatusBar counts={a.statusCounts} /></CardBody>
            <div className="grid grid-cols-3 border-t border-line text-center text-sm">
              <div className="p-3"><p className="num text-lg font-semibold">{a.recovery.contacted}</p><p className="text-xs text-ink-3">Contacted</p></div>
              <div className="border-x border-line p-3"><p className="num text-lg font-semibold">{a.recovery.recovered}</p><p className="text-xs text-ink-3">Recovered</p></div>
              <div className="p-3"><p className="num text-lg font-semibold">{pct(a.recovery.rate)}</p><p className="text-xs text-ink-3">Recovery rate</p></div>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid-cols-1 mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Daily check-ins" description={`${a.attendance.today} today · ${a.attendance.last7Days} this week · ${a.attendance.avgVisitsPerMember30d ?? "—"} visits per member (30 days)`} />
          <CardBody><AttendanceChart data={a.attendance.series.at(-1)?.date === today ? a.attendance.series.slice(0, -1) : a.attendance.series} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue received" description={`${period}. Payments confirmed, not estimates.`} />
          <CardBody>
            <MagnitudeBars unit={sym} data={[
              { label: "Renewals", value: Math.round(a.renewalRevenuePaisa / 100) },
              { label: "Marketplace", value: Math.round(a.marketplaceRevenuePaisa / 100) },
              { label: "PT & classes", value: Math.round(a.ptRevenuePaisa / 100) },
            ]} />
            <p className="mt-3 text-sm text-ink-3">Monthly recurring (active memberships): <span className="num font-medium text-ink">{formatMoney(a.mrrPaisa, sym)}</span></p>
          </CardBody>
        </Card>
      </div>
      <EstimateNote className="mt-6">Figures marked &ldquo;Estimate&rdquo; are calculated from attendance and membership patterns and are not guarantees. Everything else is recorded data.</EstimateNote>
    </>
  );
}
