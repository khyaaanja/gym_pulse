import { requireAdmin } from "@/lib/page-auth";
import { adminCan } from "@/lib/rbac";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";

export default async function Plans() {
  const s = await requireAdmin("billing.view");
  const plans = await prisma.saasPlan.findMany({ include: { _count: { select: { gyms: true } } }, orderBy: { sortOrder: "asc" } });
  const edit = adminCan(s.admin.role, "plans.manage");
  const fields = (p?: (typeof plans)[number]): FieldSpec[] => [
    ...(p ? [] : [{ name: "key", label: "Key (lowercase, no spaces)", required: true }]),
    { name: "name", label: "Name", required: true, defaultValue: p?.name },
    { name: "description", label: "Description", defaultValue: p?.description },
    { name: "priceRupees", label: "Price (NPR)", type: "number", required: true, defaultValue: p ? p.pricePaisa / 100 : undefined },
    { name: "billingPeriod", label: "Billing period", type: "select", required: true, defaultValue: p?.billingPeriod ?? "MONTHLY", options: [{ value: "MONTHLY", label: "Monthly" }, { value: "YEARLY", label: "Yearly" }] },
    { name: "memberLimit", label: "Member limit (empty = unlimited)", type: "number", defaultValue: p?.memberLimit },
    { name: "staffLimit", label: "Staff limit", type: "number", defaultValue: p?.staffLimit },
    { name: "storageLimitMb", label: "Storage limit (MB)", type: "number", defaultValue: p?.storageLimitMb },
    { name: "importsPerMonth", label: "Imports per month", type: "number", defaultValue: p?.importsPerMonth },
    { name: "predictionsPerMonth", label: "Estimates per month", type: "number", defaultValue: p?.predictionsPerMonth },
    { name: "notificationsPerMonth", label: "Messages per month", type: "number", defaultValue: p?.notificationsPerMonth },
    { name: "highlights", label: "Highlights (one per line)", type: "list", defaultValue: p?.highlights.join("\n") },
    { name: "freeMonths", label: "Months free at signup", type: "number", defaultValue: p?.freeMonths ?? 0, hint: "0 = the platform trial length. Shown on the pricing page; the first invoice comes after." },
    { name: "sortOrder", label: "Order", type: "number", defaultValue: p?.sortOrder ?? 0 },
    { name: "isPublic", label: "Shown on the pricing page", type: "checkbox", defaultValue: p?.isPublic ?? true },
    { name: "active", label: "Available", type: "checkbox", defaultValue: p?.active ?? true },
  ];
  return (
    <>
      <PageHeader title="Plans" description="Prices and limits are read from here everywhere — nothing is hard-coded. Features per plan are set in Feature Flags." actions={edit ? <FormDialog trigger={<Button>New plan</Button>} title="New plan" endpoint="/api/admin/plans" fields={fields()} /> : undefined} />
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Plan</Th><Th className="text-right">Price</Th><Th className="text-right">Free</Th><Th className="text-right">Members</Th><Th className="text-right">Imports/mo</Th><Th className="text-right">Estimates/mo</Th><Th className="text-right">Gyms</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.name}<span className="block text-xs text-ink-3">{p.key}</span></Td>
              <Td className="num text-right">{formatMoney(p.pricePaisa)}/{p.billingPeriod === "YEARLY" ? "yr" : "mo"}</Td><Td className="num text-right">{p.freeMonths ? `${p.freeMonths} mo` : "trial"}</Td>
              <Td className="num text-right">{p.memberLimit ?? "∞"}</Td><Td className="num text-right">{p.importsPerMonth ?? "∞"}</Td><Td className="num text-right">{p.predictionsPerMonth ?? "∞"}</Td><Td className="num text-right">{p._count.gyms}</Td>
              <Td><StatusPill status={p.active ? "ACTIVE" : "ARCHIVED"} /></Td>
              <Td className="text-right">{edit && <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={p.name} endpoint={`/api/admin/plans/${p.id}`} method="PATCH" fields={fields(p)} />}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
