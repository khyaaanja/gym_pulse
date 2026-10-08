import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/page-auth";
import { platformFinance } from "@/services/platform-finance";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function Reports() {
  await requireAdmin("analytics.view");
  const f = await platformFinance(6);
  const now = f.series.at(-1)!;
  const prev = f.series.at(-2);
  const platformIncome = (m: (typeof f.series)[number]) => m.saas + m.commission;
  const change = prev && platformIncome(prev) > 0 ? Math.round(((platformIncome(now) - platformIncome(prev)) / platformIncome(prev)) * 100) : null;
  const peak = Math.max(1, ...f.series.map(platformIncome));
  const reports = [["gyms", "Gyms", "Every gym with plan, status and member count."], ["subscriptions", "Subscription invoices", "All SaaS invoices and payment references."], ["commissions", "Commissions & payables", "Platform commission, vendor payables and SaaS revenue ledger entries."]];
  return (
    <>
      <PageHeader title="Reports" description="Platform finances from the ledger, and CSV exports. Gym-level reports are available inside each gym." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Monthly recurring revenue" value={formatMoney(f.mrr)} period={`${f.payingGyms} paying gym${f.payingGyms === 1 ? "" : "s"}`} definition="Active and past-due subscriptions; yearly plans divided by 12. Trials excluded." />
        <Metric label="Platform income this month" value={formatMoney(platformIncome(now))} trend={change === null ? null : { text: `${change >= 0 ? "+" : ""}${change}% vs last month`, good: change >= 0 }} definition="SaaS subscription revenue plus marketplace commission." />
        <Metric label="Marketplace sales this month" value={formatMoney(now.marketplaceGross)} period="gross, all gyms" />
        <Metric label="Owed to vendors this month" value={formatMoney(now.vendorPayable)} period="vendor payables" />
      </div>

      <Card className="mt-4">
        <CardHeader title="Last 6 months" description="Nepal time. Money processed for gyms passes through to them; platform income is subscriptions plus commission." />
        <CardBody>
          <Table>
            <thead><tr><Th>Month</Th><Th className="text-right">Subscriptions</Th><Th className="text-right">Commission</Th><Th className="w-[30%]">Platform income</Th><Th className="text-right">Marketplace gross</Th><Th className="text-right">Vendor payables</Th><Th className="text-right">Memberships processed</Th></tr></thead>
            <tbody>{f.series.map((m) => (
              <tr key={m.month}>
                <Td className="whitespace-nowrap font-medium">{monthLabel(m.month)}</Td>
                <Td className="num text-right">{formatMoney(m.saas)}</Td>
                <Td className="num text-right">{formatMoney(m.commission)}</Td>
                <Td><span className="flex items-center gap-2"><span className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (platformIncome(m) / peak) * 100)}%` }} aria-hidden /><span className="num whitespace-nowrap text-sm">{formatMoney(platformIncome(m))}</span></span></Td>
                <Td className="num text-right">{formatMoney(m.marketplaceGross)}</Td>
                <Td className="num text-right">{formatMoney(m.vendorPayable)}</Td>
                <Td className="num text-right">{formatMoney(m.membership)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Busiest gyms" description="Payments processed in the last 30 days (memberships and marketplace)." />
          <CardBody>
            {f.topGyms.length === 0 ? <p className="text-sm text-ink-3">No payments in the last 30 days.</p> : (
              <ol className="divide-y divide-line text-sm">{f.topGyms.map((g) => <li key={g.id} className="flex justify-between gap-3 py-2.5"><Link href={`/super-admin/gyms/${g.id}`} className="font-medium hover:underline">{g.name}</Link><span className="num">{formatMoney(g.total)}</span></li>)}</ol>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Exports" description="CSV, opens in Excel or Google Sheets." />
          <CardBody>
            <ul className="divide-y divide-line">{reports.map(([k, t, d]) => (
              <li key={k} className="flex items-start gap-4 py-3"><div className="flex-1"><p className="font-semibold">{t}</p><p className="text-sm text-ink-3">{d}</p></div><a className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium ring-1 ring-line hover:bg-surface-2" href={`/api/admin/reports/${k}`} download><Download className="size-4" aria-hidden /> CSV</a></li>
            ))}</ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
