import Link from "next/link";
import { requireStaff } from "@/lib/page-auth";
import { formatDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { ReportView } from "@/components/app/report-view";

export const metadata = { title: "Know Your Gym" };

export default async function Forecast() {
  const ctx = await requireStaff("prediction.view");
  const [latest, history] = await Promise.all([
    ctx.db.predictionReport.findFirst({ orderBy: { generatedAt: "desc" }, include: { factors: { orderBy: { sortOrder: "asc" } }, revenueProjection: true } }),
    ctx.db.predictionReport.findMany({ orderBy: { generatedAt: "desc" }, take: 12, select: { id: true, generatedAt: true, source: true, confidence: true, lossRangeLow: true, lossRangeHigh: true } }),
  ]);
  return (
    <>
      <PageHeader title="Know Your Gym" description="An estimated view of member loss, what's driving it, and what contacting members could change." actions={
        <>
          {ctx.can("imports.create") && <Button asChild variant="secondary"><Link href="/app/imports/new">Analyze records</Link></Button>}
          <ActionButton endpoint="/api/gym/predictions" success="Refreshing the estimate — this takes a few seconds">Refresh estimate</ActionButton>
        </>
      } />
      {!ctx.flags.churn_prediction ? (
        <Card><EmptyState title="Churn estimates aren't on your plan" body="Upgrade to Growth or Pro to see estimated member loss and forecasts." /></Card>
      ) : latest ? (
        <ReportView report={latest} symbol={ctx.gym.currencySymbol} canImport={ctx.can("imports.create")} />
      ) : (
        <Card><EmptyState title="No estimate yet" body="Understand your member risk in minutes. Upload your attendance sheet to generate an estimated churn report." action={ctx.can("imports.create") ? <Button asChild><Link href="/app/imports/new">Analyze records</Link></Button> : undefined} /></Card>
      )}
      {history.length > 1 && (
        <Card className="mt-4">
          <CardHeader title="Earlier estimates" />
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <Link href={`/app/forecast/${h.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2">
                    <span>{formatDate(h.generatedAt)} <span className="text-ink-3">· {h.source.toLowerCase()}</span></span>
                    <span className="flex items-center gap-3">{h.confidence === "INSUFFICIENT" ? <StatusPill status="SKIPPED" /> : <span className="num">{h.lossRangeLow}–{h.lossRangeHigh}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
