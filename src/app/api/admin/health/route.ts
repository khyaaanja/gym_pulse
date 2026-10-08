import { adminRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { pushConfigured } from "@/services/notifications/push";

export const GET = adminRoute({ permission: "analytics.view" }, async () => {
  const since = new Date(Date.now() - 86_400_000);
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatencyMs = Date.now() - t0;
  const [metrics, importMs, jobCounts, oldest, notif, payFail, webhookFail, predFail, pushDevices] = await Promise.all([
    prisma.metricSample.groupBy({ by: ["name"], where: { createdAt: { gte: since } }, _count: true, _avg: { value: true }, _max: { value: true } }),
    prisma.metricSample.aggregate({ where: { name: "import.processing_ms", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _avg: { value: true }, _count: true }),
    prisma.job.groupBy({ by: ["status"], _count: true }),
    prisma.job.findFirst({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
    prisma.notification.groupBy({ by: ["status"], where: { createdAt: { gte: since }, channel: { not: "IN_APP" } }, _count: true }),
    prisma.payment.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.paymentWebhookEvent.count({ where: { receivedAt: { gte: since }, status: { in: ["REJECTED", "AMOUNT_MISMATCH"] } } }),
    prisma.job.count({ where: { type: "prediction.generate", status: "DEAD" } }),
    prisma.pushSubscription.count({ where: { session: { revokedAt: null, expiresAt: { gt: new Date() } } } }),
  ]);
  const m = (name: string) => metrics.find((x) => x.name === name);
  const queueLagSeconds = oldest ? Math.round((Date.now() - oldest.runAt.getTime()) / 1000) : 0;
  const dead = jobCounts.find((j) => j.status === "DEAD")?._count ?? 0;
  const checks = [
    { key: "database", label: "Database", ok: dbLatencyMs < 200, value: `${dbLatencyMs} ms` },
    { key: "queue", label: "Job queue lag", ok: queueLagSeconds < 300, value: `${queueLagSeconds}s` },
    { key: "dead", label: "Dead-lettered jobs", ok: dead === 0, value: String(dead) },
    { key: "api", label: "API errors (24h)", ok: (m("api.error")?._count ?? 0) < 20, value: String(m("api.error")?._count ?? 0) },
    { key: "slow", label: "Slow API requests (24h)", ok: (m("api.slow")?._count ?? 0) < 100, value: String(m("api.slow")?._count ?? 0) },
    { key: "ocr", label: "OCR failures (24h)", ok: (m("import.ocr_failed")?._count ?? 0) < 5, value: String(m("import.ocr_failed")?._count ?? 0) },
    { key: "prediction", label: "Prediction failures", ok: predFail + (m("prediction.failed")?._count ?? 0) === 0, value: String(predFail + (m("prediction.failed")?._count ?? 0)) },
    { key: "payments", label: "Payment failures (24h)", ok: payFail < 20, value: String(payFail) },
    { key: "webhooks", label: "Rejected webhooks (24h)", ok: webhookFail === 0, value: String(webhookFail) },
    { key: "push", label: "Web Push", ok: pushConfigured(), value: pushConfigured() ? `${pushDevices} active device${pushDevices === 1 ? "" : "s"}` : "VAPID keys not set" },
    { key: "notifications", label: "Notification failures (24h)", ok: (notif.find((n) => n.status === "FAILED")?._count ?? 0) < 20, value: String(notif.find((n) => n.status === "FAILED")?._count ?? 0) },
  ];
  return {
    checks,
    importProcessing: { avgMs: Math.round(importMs._avg.value ?? 0), runs7d: importMs._count },
    apiSlowAvgMs: Math.round(m("api.slow")?._avg.value ?? 0),
    jobs: jobCounts,
    notifications24h: notif,
    ocrConfigured: (process.env.OCR_PROVIDER ?? "none") !== "none",
    malwareScanner: process.env.CLAMAV_HOST ? "ClamAV configured" : "Not configured",
    errorMonitoring: process.env.ERROR_WEBHOOK_URL ? "Configured" : "Not configured",
  };
});
