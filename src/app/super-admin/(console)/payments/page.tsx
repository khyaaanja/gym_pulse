import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { daysAgo } from "@/lib/time";
import { decryptJson } from "@/lib/crypto";
import { formatMoney } from "@/lib/money";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export default async function Payments() {
  await requireAdmin("payments.manage");
  const [configs, gymCounts, recent, webhooks, txs, ledger] = await Promise.all([
    prisma.paymentProviderConfig.findMany({ where: { gymId: null } }),
    prisma.paymentProviderConfig.groupBy({ by: ["providerKey"], where: { gymId: { not: null }, enabled: true }, _count: true }),
    prisma.payment.groupBy({ by: ["provider", "status"], where: { method: "ONLINE", createdAt: { gte: daysAgo(7) } }, _count: true }),
    prisma.paymentWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30 }),
    prisma.payment.findMany({ include: { gym: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.ledgerEntry.groupBy({ by: ["account"], _sum: { amountPaisa: true } }),
  ]);
  return (
    <>
      <PageHeader title="Payments" description="Nepal payment providers through adapters. Gyms connect their own merchant accounts; success is only recorded after server-side verification." />
      <Card>
        <CardHeader title="Providers" />
        <CardBody>
          <Table>
            <thead><tr><Th>Provider</Th><Th>Enabled</Th><Th>Environment</Th><Th>Methods</Th><Th className="text-right">Gyms connected</Th><Th>Health (7d)</Th><Th /></tr></thead>
            <tbody>{Object.values(PAYMENT_ADAPTERS).map((a) => {
              const c = configs.find((x) => x.providerKey === a.key);
              const mine = recent.filter((r) => r.provider === a.key);
              const total = mine.reduce((x, r) => x + r._count, 0);
              const failed = mine.filter((r) => r.status === "FAILED").reduce((x, r) => x + r._count, 0);
              const creds = decryptJson<Record<string, string>>(c?.credentialsEnc) ?? {};
              return (
                <tr key={a.key}>
                  <Td className="font-medium">{a.name}<span className="block text-xs text-ink-3">Webhook/return: /api/{a.key === "sandbox" ? "webhooks/payments" : "payments/return"}/{a.key}</span></Td>
                  <Td><StatusPill status={c?.enabled ? "ACTIVE" : "ARCHIVED"} /></Td>
                  <Td>{c?.environment.toLowerCase() ?? "—"}</Td>
                  <Td className="text-ink-2">{(c?.methods ?? a.methods).join(", ")}</Td>
                  <Td className="num text-right">{a.key === "sandbox" ? "all (test)" : gymCounts.find((g) => g.providerKey === a.key)?._count ?? 0}</Td>
                  <Td>{total === 0 ? <span className="text-ink-3">No traffic</span> : failed / total > 0.3 ? <StatusPill status="FAILED" /> : <StatusPill status="ACTIVE" />} <span className="num text-xs text-ink-3">{failed}/{total} failed</span></Td>
                  <Td className="text-right"><FormDialog trigger={<Button size="sm" variant="secondary">Configure</Button>} title={a.name} description={a.key === "sandbox" ? "The test gateway can never be enabled in production." : "Platform-level credentials (used for GymPulse subscription billing). Gyms add their own merchant keys."} endpoint="/api/admin/payment-providers" method="PUT"
                    transform="admin.paymentProvider" transformArgs={{ key: a.key, fields: a.credentialFields }}
                    fields={[...a.credentialFields.map((f) => ({ name: f, label: f, type: "password" as const, placeholder: creds[f] ? "•••• saved" : undefined })), { name: "environment", label: "Environment", type: "select", required: true, defaultValue: c?.environment ?? "SANDBOX", options: [{ value: "SANDBOX", label: "Sandbox" }, { value: "LIVE", label: "Live" }] }, { name: "methods", label: "Payment methods (comma separated)", defaultValue: (c?.methods ?? a.methods).join(", ") }, { name: "enabled", label: "Enabled", type: "checkbox", defaultValue: c?.enabled }]} /></Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </CardBody>
      </Card>
      <div className="grid-cols-1 mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Webhook events" description="Retry re-checks the payment with the provider's status API." />
          <CardBody><ul className="divide-y divide-line text-sm">{webhooks.map((w) => <li key={w.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate"><span className="font-medium">{w.provider}</span> <span className="text-ink-3">· {w.receivedAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}{w.error ? ` · ${w.error}` : ""}</span></span><span className="flex shrink-0 items-center gap-1"><StatusPill status={w.status === "PROCESSED" ? "SUCCEEDED" : w.status === "REJECTED" || w.status === "AMOUNT_MISMATCH" ? "FAILED" : "PENDING"} />{w.paymentId && w.provider !== "sandbox" && w.status !== "PROCESSED" && <ActionButton size="sm" variant="ghost" endpoint={`/api/admin/webhooks/${w.id}`}>Retry</ActionButton>}</span></li>)}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Ledger balances" description="Every confirmed money movement, all gyms." />
          <CardBody><dl className="divide-y divide-line text-sm">{ledger.map((l) => <div key={l.account} className="flex justify-between py-2"><dt>{l.account.replace(/_/g, " ").toLowerCase()}</dt><dd className="num font-medium">{formatMoney(l._sum.amountPaisa ?? 0)}</dd></div>)}</dl></CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent transactions" />
        <CardBody>
          <Table><thead><tr><Th>When</Th><Th>Gym</Th><Th>Reference</Th><Th>For</Th><Th>Method</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>{txs.map((p) => <tr key={p.id}><Td className="whitespace-nowrap">{p.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td><Td>{p.gym.name}</Td><Td className="num text-xs">{p.reference}</Td><Td>{p.purpose === "MEMBERSHIP" ? "membership" : "order"}</Td><Td>{p.provider ?? p.method.toLowerCase()}</Td><Td><StatusPill status={p.status} /></Td><Td className="num text-right">{formatMoney(p.amountPaisa)}</Td></tr>)}</tbody></Table>
        </CardBody>
      </Card>
    </>
  );
}
