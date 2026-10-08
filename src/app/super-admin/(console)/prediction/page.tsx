import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { BUILTIN_CONFIG, DEFAULT_WEIGHTS, DEFAULT_LABELS, MODEL_VERSION } from "@/config/prediction";
import { modelQuality } from "@/services/risk/run";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, EstimateNote } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default async function Prediction() {
  await requireAdmin("prediction.manage");
  const [cfgRow, q, recent] = await Promise.all([prisma.predictionConfig.findFirst({ where: { gymId: null } }), modelQuality(MODEL_VERSION), prisma.predictionReport.findMany({ orderBy: { generatedAt: "desc" }, take: 15, include: { gym: { select: { name: true } } } })]);
  const cfg = { ...BUILTIN_CONFIG, ...(cfgRow ?? {}) };
  const w = { ...DEFAULT_WEIGHTS, ...((cfgRow?.weights as object) ?? {}) } as typeof DEFAULT_WEIGHTS;
  const labels = { ...DEFAULT_LABELS, ...((cfgRow?.labels as object) ?? {}) } as typeof DEFAULT_LABELS;
  const intField = (name: keyof typeof BUILTIN_CONFIG, label: string, hint?: string) => ({ name, label, type: "number" as const, required: true, defaultValue: cfg[name] as number, hint });
  return (
    <>
      <PageHeader title="Prediction engine" description={`${MODEL_VERSION} — transparent rules and statistics, not machine learning. Every assessment stores its model version and inputs, so reports stay reproducible.`} actions={
        <>
          <ActionButton variant="secondary" endpoint="/api/admin/operations" body={{ op: "evaluate_predictions" }} success="Outcome evaluation queued">Evaluate outcomes</ActionButton>
          <FormDialog trigger={<Button>Edit rules</Button>} title="Prediction rules" description="Changes apply to the next calculation; past reports keep the configuration they were made with." endpoint="/api/admin/prediction" method="PUT"
            transform="admin.predictionRules"
            fields={[
              intField("inactivityThresholdDays", "At risk after N days without a visit"), intField("attentionAfterDays", "Attention after N days"),
              intField("analysisWindowDays", "Analysis window (days)"), intField("forecastHorizonDays", "Forecast horizon (days)"),
              intField("minMembers", "Minimum members for an estimate"), intField("minAttendanceRecords", "Minimum attendance records"), intField("minHistoryDays", "Minimum history (days)"),
              intField("moderateThreshold", "Moderate risk from score"), intField("highThreshold", "High risk from score"), intField("criticalThreshold", "Critical from score"),
              intField("lostAfterExpiryDays", "Lost after expiry + N days"), intField("protectedRevenueMonths", "Protected revenue assumption (months)"),
              { name: "nonExpiringChurnShare", label: "Loss share for members not expiring in the horizon (0–1)", type: "number", step: "0.05", required: true, defaultValue: cfg.nonExpiringChurnShare },
              ...Object.keys(DEFAULT_WEIGHTS).map((k) => ({ name: `w_${k}`, label: `Weight: ${k}`, type: "number" as const, required: true, defaultValue: w[k as keyof typeof w] })),
              ...Object.keys(DEFAULT_LABELS).map((k) => ({ name: `l_${k}`, label: `Label: ${k.toLowerCase()}`, required: true, defaultValue: labels[k as keyof typeof labels] })),
            ]} />
        </>
      } />
      <div className="grid-cols-1 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Current rules" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[["At risk after", `${cfg.inactivityThresholdDays} days`], ["Attention after", `${cfg.attentionAfterDays} days`], ["Window", `${cfg.analysisWindowDays} days`], ["Horizon", `${cfg.forecastHorizonDays} days`], ["Min. members", cfg.minMembers], ["Min. records", cfg.minAttendanceRecords], ["Min. history", `${cfg.minHistoryDays} days`], ["Thresholds", `${cfg.moderateThreshold} / ${cfg.highThreshold} / ${cfg.criticalThreshold}`], ["Protected revenue", `${cfg.protectedRevenueMonths} months`], ["Non-expiring loss share", cfg.nonExpiringChurnShare]].map(([k, v]) => <div key={String(k)} className="flex justify-between border-b border-line py-1.5"><dt className="text-ink-3">{k}</dt><dd className="num font-medium">{v}</dd></div>)}
            </dl>
            <p className="mt-4 text-sm font-medium">Weights</p>
            <ul className="mt-2 space-y-1.5">{Object.entries(w).map(([k, v]) => <li key={k} className="flex items-center gap-3 text-sm"><span className="w-28 text-ink-3">{k}</span><span className="h-2 rounded-full bg-brand" style={{ width: `${v * 2}px` }} /><span className="num">{v}</span></li>)}</ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How well it's doing" description={`${q.evaluated} assessments with known outcomes. "Flagged" = high or critical.`} />
          <CardBody>
            {q.evaluated === 0 ? <p className="text-sm text-ink-3">No outcomes yet. Outcomes are recorded once each estimate&apos;s horizon has passed.</p> : (
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">Precision</dt><dd className="display num text-2xl font-semibold">{pct(q.precision)}</dd><dd className="text-xs text-ink-3">flagged members who did leave</dd></div>
                  <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">Recall</dt><dd className="display num text-2xl font-semibold">{pct(q.recall)}</dd><dd className="text-xs text-ink-3">leavers who were flagged</dd></div>
                  <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">False positives</dt><dd className="num text-xl font-semibold">{q.falsePositives}</dd></div>
                  <div className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">False negatives</dt><dd className="num text-xl font-semibold">{q.falseNegatives}</dd></div>
                </dl>
                <p className="mt-4 text-sm font-medium">Calibration</p>
                <Table><thead><tr><Th>Estimated likelihood</Th><Th className="text-right">Members</Th><Th className="text-right">Mean estimate</Th><Th className="text-right">Actually left</Th></tr></thead>
                  <tbody>{q.calibration.map((b) => <tr key={b.bucket}><Td>{b.bucket * 10}–{b.bucket * 10 + 9}%</Td><Td className="num text-right">{b.n}</Td><Td className="num text-right">{pct(b.meanPredicted)}</Td><Td className="num text-right">{pct(b.observedRate)}</Td></tr>)}</tbody></Table>
                <EstimateNote className="mt-3">Likelihoods switch from the heuristic curve to observed rates once 200 outcomes exist for this model version.</EstimateNote>
              </>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent reports" />
        <CardBody>
          <Table><thead><tr><Th>Generated</Th><Th>Gym</Th><Th>Source</Th><Th>Model</Th><Th>Confidence</Th><Th className="text-right">At risk (range)</Th></tr></thead>
            <tbody>{recent.map((r) => <tr key={r.id}><Td className="whitespace-nowrap">{r.generatedAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td><Td>{r.gym.name}</Td><Td>{r.source.toLowerCase()}</Td><Td className="text-xs">{r.modelVersion}</Td><Td>{r.confidence.toLowerCase()}{r.calibrated ? " · calibrated" : ""}</Td><Td className="num text-right">{r.rangeLow === null ? "—" : `${r.rangeLow}–${r.rangeHigh}`}</Td></tr>)}</tbody></Table>
        </CardBody>
      </Card>
    </>
  );
}
