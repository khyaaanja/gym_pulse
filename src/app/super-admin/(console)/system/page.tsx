import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { daysAgo, msSince, now } from "@/lib/time";
import { pushConfigured } from "@/services/notifications/push";

async function timed(fn: () => Promise<unknown>) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default async function System() {
  await requireAdmin("system.manage");
  const since = daysAgo(1);
  const dbMs = await timed(() => prisma.$queryRaw`SELECT 1`);
  const [counts, dead, oldest, metrics, importAvg, gyms, failedNotifs, pushDevices] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: true }),
    prisma.job.findMany({ where: { status: "DEAD" }, orderBy: { finishedAt: "desc" }, take: 30 }),
    prisma.job.findFirst({ where: { status: "PENDING", runAt: { lte: now() } }, orderBy: { runAt: "asc" } }),
    prisma.metricSample.groupBy({ by: ["name"], where: { createdAt: { gte: since } }, _count: true, _avg: { value: true } }),
    prisma.metricSample.aggregate({ where: { name: "import.processing_ms" }, _avg: { value: true } }),
    prisma.gym.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.notification.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.pushSubscription.count({ where: { session: { revokedAt: null, expiresAt: { gt: now() } } } }),
  ]);
  const lag = oldest ? Math.round(msSince(oldest.runAt) / 1000) : 0;
  const m = (n: string) => metrics.find((x) => x.name === n);
  const checks: [string, boolean, string][] = [
    ["Database", dbMs < 200, `${dbMs} ms`],
    ["Queue lag", lag < 300, `${lag}s`],
    ["Dead-lettered jobs", dead.length === 0, String(counts.find((c) => c.status === "DEAD")?._count ?? 0)],
    ["API errors (24h)", (m("api.error")?._count ?? 0) < 20, String(m("api.error")?._count ?? 0)],
    ["Slow requests (24h)", (m("api.slow")?._count ?? 0) < 100, `${m("api.slow")?._count ?? 0}${m("api.slow") ? ` · avg ${Math.round(m("api.slow")!._avg.value ?? 0)} ms` : ""}`],
    ["OCR failures (24h)", (m("import.ocr_failed")?._count ?? 0) < 5, String(m("import.ocr_failed")?._count ?? 0)],
    ["Prediction failures (24h)", !m("prediction.failed"), String(m("prediction.failed")?._count ?? 0)],
    ["Avg. import processing", true, importAvg._avg.value ? `${Math.round(importAvg._avg.value)} ms` : "—"],
    ["OCR service", (process.env.OCR_PROVIDER ?? "none") !== "none", (process.env.OCR_PROVIDER ?? "none") === "none" ? "OCR service unavailable" : "Tesseract"],
    ["Malware scanning", !!process.env.CLAMAV_HOST, process.env.CLAMAV_HOST ? "ClamAV" : "Not configured"],
    ["Error monitoring", !!process.env.ERROR_WEBHOOK_URL, process.env.ERROR_WEBHOOK_URL ? "Configured" : "Not configured"],
    ["Web Push", pushConfigured(), pushConfigured() ? `${pushDevices} active device${pushDevices === 1 ? "" : "s"}` : "VAPID keys not set"],
  ];
  const gymOpts = gyms.map((g) => ({ value: g.id, label: g.name }));
  const op = (opName: string, label: string, needsTarget?: string) => (
    <FormDialog trigger={<Button variant="secondary">{label}</Button>} title={label} endpoint="/api/admin/operations" submitLabel="Run" successMessage="Queued" transform="admin.operation" transformArgs={{ op: opName }} fields={[
      ...(opName !== "retry_notification" && opName !== "rebuild_search_index" && opName !== "evaluate_predictions" ? [{ name: "gymId", label: "Gym", type: "select" as const, required: true, options: gymOpts }] : []),
      ...(needsTarget ? [{ name: "targetId", label: needsTarget, required: true }] : []),
    ]} />
  );
  return (
    <>
      <PageHeader title="System" description="Health, background jobs and a fixed set of safe operations. There is intentionally no raw database access here." />
      <Card>
        <CardHeader title="Health" />
        <CardBody><ul className="grid-cols-1 grid gap-2 sm:grid-cols-2">{checks.map(([l, ok, v]) => <li key={l} className="flex items-center gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">{ok ? <CheckCircle2 className="size-5 text-ok" /> : <AlertTriangle className="size-5 text-warn" />}<span className="flex-1">{l}</span><span className="num font-medium">{v}</span></li>)}</ul></CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Operations" description="Idempotent and audited." />
        <CardBody className="flex flex-wrap gap-2">
          {op("recalculate_streaks", "Recalculate streaks")}{op("recalculate_risk", "Recalculate risk scores")}{op("recalculate_revenue", "Recalculate revenue metrics")}
          {op("reprocess_import", "Reprocess failed import", "Import job ID")}{op("retry_notification", "Retry notification", "Notification ID")}
          {op("rebuild_search_index", "Rebuild search index")}{op("evaluate_predictions", "Evaluate prediction outcomes")}
        </CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Background jobs" description={counts.map((c) => `${c.status.toLowerCase()}: ${c._count}`).join(" · ")} />
        <CardBody>
          {dead.length === 0 ? <p className="text-sm text-ink-3">No dead-lettered jobs.</p> : (
            <Table><thead><tr><Th>Job</Th><Th>Attempts</Th><Th>Failed at</Th><Th>Error</Th><Th /></tr></thead>
              <tbody>{dead.map((j) => <tr key={j.id}><Td className="font-medium">{j.type}<span className="block text-xs text-ink-3">{j.id}</span></Td><Td className="num">{j.attempts}/{j.maxAttempts}</Td><Td className="whitespace-nowrap">{j.finishedAt?.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td><Td className="max-w-md truncate text-xs text-ink-3">{j.lastError?.trimStart().split("\n")[0]}</Td><Td className="text-right"><ActionButton size="sm" variant="secondary" endpoint={`/api/admin/jobs/${j.id}`} success="Job re-queued">Retry</ActionButton></Td></tr>)}</tbody></Table>
          )}
        </CardBody>
      </Card>
      {failedNotifs.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Failed notifications" />
          <CardBody><ul className="divide-y divide-line text-sm">{failedNotifs.map((n) => <li key={n.id} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate">{n.channel.toLowerCase()} · {n.title} <span className="text-ink-3">· {n.error}</span></span><ActionButton size="sm" variant="ghost" endpoint="/api/admin/operations" body={{ op: "retry_notification", targetId: n.id }}>Retry</ActionButton></li>)}</ul></CardBody>
        </Card>
      )}
    </>
  );
}
