import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Logo } from "@/components/brand/logo";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SignOut } from "@/components/app/sign-out";

export const metadata = { title: "Vendor" };
export const dynamic = "force-dynamic";

export default async function Vendor() {
  const s = await getUserSession();
  if (!s) redirect("/login");
  const link = await prisma.vendorUser.findFirst({ where: { userId: s.userId }, include: { vendor: true } });
  if (!link) redirect("/app");
  const v = link.vendor;
  const [gyms, products, items, categories, payable] = await Promise.all([
    prisma.vendorGym.findMany({ where: { vendorId: v.id, active: true }, include: { gym: { select: { id: true, name: true } } } }),
    prisma.marketplaceProduct.findMany({ where: { vendorId: v.id }, include: { gym: { select: { name: true } }, category: true }, orderBy: { updatedAt: "desc" } }),
    prisma.orderItem.findMany({ where: { vendorId: v.id, order: { status: { in: ["PAID", "FULFILLED"] } } }, include: { order: { select: { number: true, paidAt: true, status: true, gym: { select: { name: true } } } } }, take: 50, orderBy: { order: { paidAt: "desc" } } }),
    prisma.marketplaceCategory.findMany({ where: { active: true, kind: "PRODUCT" }, orderBy: { sortOrder: "asc" } }),
    prisma.ledgerEntry.aggregate({ _sum: { amountPaisa: true }, where: { vendorId: v.id, account: "VENDOR_PAYABLE" } }),
  ]);
  const approved = v.status === "APPROVED";
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between"><Logo href="/vendor" /><div className="w-32"><SignOut /></div></header>
      <h1 className="display mt-8 text-3xl font-semibold">{v.name}</h1>
      <p className="mt-1 flex items-center gap-2 text-ink-3">Vendor account <StatusPill status={v.status} /></p>
      {!approved && <p className="mt-4 rounded-2xl bg-warn-soft p-4 text-sm text-warn">Your vendor account is {v.status.toLowerCase()}. You can list products once GymPulse approves it.</p>}
      <div className="grid-cols-1 mt-6 grid gap-4 sm:grid-cols-3">
        <Metric label="Payable to you" value={formatMoney(payable._sum.amountPaisa ?? 0)} definition="Your share of paid orders (after platform and gym commission)." />
        <Metric label="Units sold" value={items.reduce((a, i) => a + i.quantity, 0)} />
        <Metric label="Gyms" value={gyms.length} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Listings" description="New listings and changes to price or description are reviewed by the gym before going live." action={approved && gyms.length > 0 ? (
          <FormDialog trigger={<Button size="sm">New listing</Button>} title="New listing" endpoint="/api/vendor/products" successMessage="Submitted for approval" fields={[
            { name: "gymId", label: "Gym", type: "select", required: true, options: gyms.map((g) => ({ value: g.gym.id, label: g.gym.name })) },
            { name: "categoryId", label: "Category", type: "select", required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
            { name: "name", label: "Name", required: true }, { name: "description", label: "Description", type: "textarea" },
            { name: "priceRupees", label: "Price (NPR)", type: "number", required: true }, { name: "inventory", label: "Stock", type: "number", required: true },
          ]} />
        ) : undefined} />
        <CardBody>
          <Table>
            <thead><tr><Th>Listing</Th><Th>Gym</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th><Th /></tr></thead>
            <tbody>{products.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.name}<span className="block text-xs text-ink-3">{p.category.name}</span></Td><Td>{p.gym.name}</Td><Td><StatusPill status={p.status} /></Td>
                <Td className="num text-right">{formatMoney(p.pricePaisa)}</Td><Td className="num text-right">{p.inventory}</Td>
                <Td className="text-right">{approved && <FormDialog trigger={<Button size="sm" variant="ghost">Update</Button>} title={p.name} endpoint={`/api/vendor/products/${p.id}`} method="PATCH" fields={[{ name: "inventory", label: "Stock", type: "number", defaultValue: p.inventory }, { name: "priceRupees", label: "Price (NPR) — needs re-approval", type: "number" }]} transform="vendor.product" />}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Sales" description="Order lines for your products. Customer details aren't shared with vendors." />
        <CardBody>
          <ul className="divide-y divide-line text-sm">{items.map((i) => <li key={i.id} className="flex justify-between py-2.5"><span>{i.name} ×{i.quantity} <span className="text-ink-3">· {i.order.gym.name} · {i.order.paidAt?.toLocaleDateString("en-GB")}</span></span><span className="num">{formatMoney(Math.round((i.unitPricePaisa * i.quantity * i.vendorBps) / 10000))}</span></li>)}</ul>
          {items.length === 0 && <p className="text-sm text-ink-3">No sales yet.</p>}
        </CardBody>
      </Card>
    </main>
  );
}
