import { Download } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { REPORTS, recoverySummary } from "@/services/reports";
import { rangeFor } from "@/services/analytics";
import { formatMoney } from "@/lib/money";
import { CardHeader } from "@/components/ui/card";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { RangeTabs } from "@/components/app/range-tabs";

export const metadata = { title: "Reports" };

const DESC: Record<string, string> = {
  members: "Everyone on your books with plan, expiry, status and streak.",
  attendance: "Every check-in in the period.",
  renewals: "Memberships that ended in the period and whether they renewed.",
  churn: "Status changes, including members who became lost.",
  risk: "The latest estimated churn risk per member, with reasons. Estimates, not facts.",
  recovery: "Follow-ups, outcomes and estimated protected revenue.",
  revenue: "Confirmed payments in the period.",
  marketplace: "Orders with gym, platform and vendor shares.",
  payments: "All payment attempts, including failed ones.",
  imports: "Record imports and their data quality.",
};

export default async function Reports({ searchParams }: PageProps<"/app/reports">) {
  const ctx = await requireStaff("reports.view");
  const { range = "30d" } = await searchParams;
  const r = ["today", "7d", "30d", "90d"].includes(String(range)) ? String(range) : "30d";
  const rec = await recoverySummary(ctx.gym.id, rangeFor(r, ctx.gym.timezone));
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const keys = (Object.keys(REPORTS) as (keyof typeof REPORTS)[]).filter((k) => (k === "payments" || k === "revenue" ? ctx.can("payments.view") : true));
  return (
    <>
      <PageHeader title="Reports" description="Download as CSV (opens in Excel or Google Sheets)." actions={<RangeTabs current={r} base="/app/reports" />} />
      {rec && (
        <Card className="mb-4">
          <CardHeader title="Member recovery" description="Follow-ups that were open during this period. Protected revenue is an estimate from your settings." />
          <CardBody>
            {rec.tasks === 0 ? <p className="text-sm text-ink-3">No follow-ups in this period. Members appear on Pulse when they stop coming.</p> : (
              <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  {[
                    ["Follow-ups", String(rec.tasks)],
                    ["Contacted", `${rec.contacted} (${pct(rec.contactRate)})`],
                    ["Came back after contact", pct(rec.returnRate)],
                    ["Median days to return", rec.medianDaysToReturn === null ? "—" : String(rec.medianDaysToReturn)],
                    ["Returned", String(rec.returned)],
                    ["Renewed", String(rec.renewed)],
                    ["Lost", String(rec.lost)],
                    ["Still open", String(rec.open)],
                  ].map(([k, v]) => <div key={k}><dt className="text-sm text-ink-3">{k}</dt><dd className="display num mt-0.5 text-2xl font-semibold">{v}</dd></div>)}
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-sm text-ink-2">
                  <span>Est. protected revenue <span className="num font-semibold text-ink">{formatMoney(rec.protectedRevenuePaisa, ctx.gym.currencySymbol)}</span></span>
                  {rec.byMethod.map((m) => <span key={m.method}>{m.method.replace("_", " ").toLowerCase()}: <span className="num">{m.returned}/{m.tasks}</span> came back</span>)}
                  {rec.failedMessages > 0 && <span className="text-risk">{rec.failedMessages} message{rec.failedMessages === 1 ? "" : "s"} not delivered</span>}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}
      <div className="grid-cols-1 grid gap-3 sm:grid-cols-2">
        {keys.map((k) => (
          <Card key={k}>
            <CardBody className="flex items-start gap-4">
              <div className="flex-1">
                <p className="font-semibold">{REPORTS[k]}</p>
                <p className="mt-0.5 text-sm text-ink-3">{DESC[k]}</p>
              </div>
              <a className="inline-flex h-9 items-center gap-2 rounded-xl bg-surface px-3 text-sm font-medium ring-1 ring-line hover:bg-surface-2" href={`/api/gym/reports/${k}?range=${r}`} download><Download className="size-4" /> CSV</a>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
