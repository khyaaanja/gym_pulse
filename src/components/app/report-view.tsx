import Link from "next/link";
import type { PredictionReport, PredictionFactor, RevenueProjection } from "@/generated/prisma/client";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EstimateNote } from "@/components/ui/misc";

type Full = PredictionReport & { factors: PredictionFactor[]; revenueProjection: RevenueProjection | null };
const CONF: Record<string, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High" };

export function ReportView({ report, symbol, canImport, linkToMembers = true }: { report: Full; symbol: string; canImport: boolean; linkToMembers?: boolean }) {
  const dq = (report.dataQuality ?? {}) as { historyDays?: number; confidenceReasons?: string[]; qualityScore?: number | null; recordsEndAsOf?: string | null };
  // Set when the gym only has uploaded records: everything is measured as of their last day.
  const asOf = dq.recordsEndAsOf ? formatDate(dq.recordsEndAsOf) : null;
  const sc = (report.scenarios ?? {}) as { ifContacted?: { low: number; high: number } | null; ifContactedNote?: string; currentPattern?: { low: number; high: number } };
  const period = report.periodStart && report.periodEnd ? `${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}` : "—";

  if (report.confidence === "INSUFFICIENT") {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <p className="display text-3xl font-semibold">Not enough data for a reliable estimate.</p>
          <p className="mx-auto mt-3 max-w-lg text-ink-2">{report.insufficientReason ?? "We need more attendance history."}</p>
          <p className="mt-2 text-sm text-ink-3">We won&apos;t show a number we can&apos;t stand behind. Individual members are still flagged from facts (like 10+ days without a visit) on the Pulse screen.</p>
          {canImport && <Button asChild className="mt-6"><Link href="/app/imports/new">Analyze existing records</Link></Button>}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="grid-cols-1 grid gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-[15px] font-medium text-ink-2">{asOf ? `${report.horizonDays} days after ${asOf}` : `Next ${report.horizonDays} days`} · estimated member loss</p>
            <p className="display num mt-1 text-[64px] font-semibold leading-none">{report.lossRangeLow}–{report.lossRangeHigh}</p>
            <p className="mt-3 text-sm text-ink-3">Estimated range. Confidence: <span className="font-medium text-ink">{CONF[report.confidence]}</span>. Based on {report.membersAnalyzed} members and {report.attendanceRecords.toLocaleString("en-IN")} attendance records ({period}).</p>
            {asOf && <p className="mt-2 text-sm text-ink-2">Measured as of <span className="font-medium text-ink">{asOf}</span>, the last day in your uploaded records. We can&apos;t see visits after that date, so members are judged on what the records show.</p>}
          </div>
          <dl className="grid grid-cols-2 gap-3 self-end">
            <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">Active members</dt><dd className="display num text-2xl font-semibold">{report.activeMembers}</dd></div>
            <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">Estimated at risk</dt><dd className="display num text-2xl font-semibold">{report.rangeLow}–{report.rangeHigh}</dd></div>
            <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">High / critical risk</dt><dd className="display num text-2xl font-semibold">{report.highRiskCount}</dd></div>
            <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">Memberships expiring</dt><dd className="display num text-2xl font-semibold">{report.expiringCount}</dd></div>
          </dl>
        </div>
      </Card>

      <div className="grid-cols-1 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What is driving the estimate?" />
          <CardBody>
            <ul className="space-y-3">
              {report.factors.map((f) => <li key={f.id} className="flex gap-3"><span className="num w-10 shrink-0 text-right text-xl font-semibold">{f.memberCount}</span><span className="text-[15px] text-ink-2">{f.description.replace(/^\d+ /, "")}</span></li>)}
              {report.factors.length === 0 && <li className="text-sm text-ink-3">No strong negative signals right now.</li>}
            </ul>
            {linkToMembers && <Button asChild variant="secondary" className="mt-5"><Link href={`/app/forecast/${report.id}`}>See members and reasons</Link></Button>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Scenarios" description="Estimates only — not promises." />
          <CardBody className="space-y-4">
            <div className="rounded-2xl bg-mist p-4">
              <p className="text-sm text-ink-3">If the current pattern continues</p>
              <p className="display num text-2xl font-semibold">{sc.currentPattern?.low ?? report.lossRangeLow}–{sc.currentPattern?.high ?? report.lossRangeHigh} members lost</p>
            </div>
            <div className="rounded-2xl bg-ok-soft p-4">
              <p className="text-sm text-ok">If at-risk members are contacted</p>
              {sc.ifContacted ? <p className="display num text-2xl font-semibold">{sc.ifContacted.low}–{sc.ifContacted.high} potentially retained</p> : <p className="font-medium">Not enough recovery history yet</p>}
              {sc.ifContactedNote && <p className="mt-1 text-xs text-ink-2">{sc.ifContactedNote}</p>}
            </div>
            {report.revenueProjection && (
              <div className="rounded-2xl bg-risk-soft p-4">
                <p className="text-sm text-risk">Estimated revenue at risk</p>
                <p className="display num text-2xl font-semibold">{formatMoney(report.revenueProjection.rangeLowPaisa, symbol)}–{formatMoney(report.revenueProjection.rangeHighPaisa, symbol)}/month</p>
                <p className="mt-1 text-xs text-ink-2">Estimated members at risk × average monthly fee ({formatMoney(report.revenueProjection.averageFeePaisa, symbol)}). Not all of this would be lost.</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="How confident is this?" />
        <CardBody>
          <ul className="grid-cols-1 grid gap-2 text-sm text-ink-2 sm:grid-cols-2">
            {(dq.confidenceReasons ?? []).map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-3" />{r}</li>)}
          </ul>
          <EstimateNote className="mt-4">
            {report.modelVersion} — a transparent, rules-based score from attendance frequency and trend, days since last visit, visit gaps, membership expiry and renewal history. No personal or sensitive attributes are used. {report.calibrated ? "Likelihoods are calibrated against past outcomes." : "Likelihoods are not yet calibrated against real outcomes, so ranges are deliberately wide."} Generated {formatDate(report.generatedAt)}.
          </EstimateNote>
        </CardBody>
      </Card>
    </div>
  );
}
