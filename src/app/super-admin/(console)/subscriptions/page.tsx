import Link from "next/link";
import { requireAdmin } from "@/lib/page-auth";
import { adminCan } from "@/lib/rbac";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";

export default async function Subscriptions() {
  const s = await requireAdmin("billing.view");
  const [subs, due] = await Promise.all([
    prisma.subscription.findMany({ include: { gym: { select: { id: true, name: true } }, plan: true }, orderBy: { currentPeriodEnd: "asc" } }),
    prisma.subscriptionInvoice.findMany({ where: { status: { in: ["DUE", "FAILED"] } }, include: { gym: { select: { name: true } } }, orderBy: { dueAt: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Subscriptions" description="GymPulse plans billed to gyms. Unpaid invoices move a subscription to past due; suspending a gym is a separate, deliberate action." />
      <Card>
        <CardHeader title="Open invoices" />
        <CardBody>
          {due.length === 0 ? <p className="text-sm text-ink-3">Nothing outstanding.</p> : (
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Gym</Th><Th>Due</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
              <tbody>{due.map((i) => <tr key={i.id}><Td className="num">{i.number}</Td><Td>{i.gym.name}</Td><Td className={i.dueAt < new Date() ? "text-risk" : ""}>{i.dueAt.toLocaleDateString("en-GB")}</Td><Td className="num text-right">{formatMoney(i.amountPaisa)}</Td>
                <Td className="text-right">{adminCan(s.admin.role, "billing.manage") && <FormDialog trigger={<Button size="sm" variant="secondary">Mark paid</Button>} title={`Record payment for ${i.number}`} endpoint={`/api/admin/subscriptions/invoices/${i.id}`} fields={[{ name: "paymentRef", label: "Bank / transfer reference", required: true }]} successMessage="Invoice marked paid" />}</Td></tr>)}</tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      <Card className="mt-4"><CardBody>
        <Table>
          <thead><tr><Th>Gym</Th><Th>Plan</Th><Th>Status</Th><Th>Period ends</Th><Th className="text-right">Price</Th></tr></thead>
          <tbody>{subs.map((x) => <tr key={x.id}><Td><Link className="hover:underline" href={`/super-admin/gyms/${x.gym.id}`}>{x.gym.name}</Link></Td><Td>{x.plan.name}</Td><Td><StatusPill status={x.status} /></Td><Td>{x.currentPeriodEnd.toLocaleDateString("en-GB")}</Td><Td className="num text-right">{formatMoney(x.plan.pricePaisa)}</Td></tr>)}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
