import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/page-auth";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EstimateBadge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { ReportView } from "@/components/app/report-view";
import { StartRecovery } from "@/components/app/start-recovery";

const PAGE = 30;
const CATS = ["ALL", "CRITICAL", "HIGH", "MODERATE", "LOW"] as const;

export default async function ReportPage({ params, searchParams }: PageProps<"/app/forecast/[id]">) {
  const ctx = await requireStaff("prediction.view");
  const { id } = await params;
  const sp = await searchParams;
  const report = await ctx.db.predictionReport.findUnique({ where: { id }, include: { factors: { orderBy: { sortOrder: "asc" } }, revenueProjection: true } });
  if (!report) notFound();
  const cat = CATS.find((c) => c === sp.category) ?? "ALL";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { reportId: report.id, riskStatus: { not: "LOST" as const }, ...(cat === "ALL" ? {} : { category: cat }) };
  const [rows, total] = await Promise.all([
    ctx.db.riskAssessment.findMany({ where, include: { member: { select: { id: true, fullName: true, memberCode: true, recoveryTasks: { where: { closedAt: null }, select: { id: true } } } } }, orderBy: { score: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    ctx.db.riskAssessment.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Risk report" description={`${formatDate(report.generatedAt)} · ${report.source === "IMPORT" ? "from imported records" : report.source.toLowerCase()} · ${report.modelVersion}`} />
      <ReportView report={report} symbol={ctx.gym.currencySymbol} canImport={ctx.can("imports.create")} linkToMembers={false} />
      <Card className="mt-4">
        <CardHeader title="Members" description="Sorted by estimated risk. Tap Why? for the reasons behind each estimate." action={
          <div className="flex flex-wrap gap-1 text-sm">{CATS.map((c) => <Link key={c} href={`/app/forecast/${report.id}?category=${c}`} className={`rounded-lg px-2.5 py-1 ${cat === c ? "bg-ink text-mist" : "text-ink-2"}`}>{c === "ALL" ? "All" : c.charAt(0) + c.slice(1).toLowerCase()}</Link>)}</div>
        } />
        <CardBody>
          <Table>
            <thead><tr><Th>Member</Th><Th>Estimate</Th><Th>Last visit</Th><Th>Visits (30d vs prior)</Th><Th>Expiry</Th><Th className="text-right">Fee / month</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const factors = r.factors as { detail: string; contribution: number }[];
                return (
                  <tr key={r.id} className="align-top">
                    <Td>
                      <Link href={`/app/members/${r.member.id}`} className="font-medium hover:underline">{r.member.fullName}</Link>
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-brand">Why?</summary>
                        <ul className="mt-2 space-y-1 text-ink-2">{factors.map((f, i) => <li key={i}>• {f.detail}</li>)}</ul>
                        <p className="mt-2 text-xs font-medium">Recommended: {r.recommendedAction}</p>
                      </details>
                    </Td>
                    <Td><EstimateBadge category={r.category} /><span className="num mt-1 block text-xs text-ink-3">score {r.score}</span></Td>
                    <Td className="whitespace-nowrap">{r.daysSinceLastVisit === null ? "—" : `${r.daysSinceLastVisit}d ago`}</Td>
                    <Td className="num">{r.visitsLast30} vs {r.visitsPrev30}</Td>
                    <Td className="whitespace-nowrap">{r.daysToExpiry === null ? "—" : r.daysToExpiry < 0 ? "expired" : `in ${r.daysToExpiry}d`}</Td>
                    <Td className="num text-right">{r.monthlyFeePaisa ? formatMoney(r.monthlyFeePaisa, ctx.gym.currencySymbol) : "—"}</Td>
                    <Td className="text-right">{ctx.can("recovery.manage") && (r.member.recoveryTasks.length ? <Link className="text-sm text-brand" href={`/app/members/${r.member.id}`}>In recovery</Link> : <StartRecovery memberId={r.member.id} />)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {total > PAGE && (
            <div className="mt-4 flex justify-between text-sm">
              <span className="text-ink-3">Page {page} of {Math.ceil(total / PAGE)}</span>
              <span className="flex gap-2">
                {page > 1 && <Link className="rounded-xl px-3 py-1.5 ring-1 ring-line" href={`/app/forecast/${report.id}?category=${cat}&page=${page - 1}`}>Previous</Link>}
                {page * PAGE < total && <Link className="rounded-xl px-3 py-1.5 ring-1 ring-line" href={`/app/forecast/${report.id}?category=${cat}&page=${page + 1}`}>Next</Link>}
              </span>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
