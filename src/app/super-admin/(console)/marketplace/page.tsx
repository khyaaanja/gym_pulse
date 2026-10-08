import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

const pct = (bps: number) => `${bps / 100}%`;

export default async function Marketplace() {
  await requireAdmin("marketplace.manage");
  const [cats, rules, pending, promos, coupons, vendors, gyms] = await Promise.all([
    prisma.marketplaceCategory.findMany({ include: { _count: { select: { products: true } } }, orderBy: { sortOrder: "asc" } }),
    prisma.commissionRule.findMany({ orderBy: [{ scope: "asc" }, { priority: "desc" }] }),
    prisma.marketplaceProduct.findMany({ where: { status: "PENDING_APPROVAL" }, include: { gym: { select: { name: true } }, vendor: { select: { name: true } } } }),
    prisma.promotion.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.coupon.findMany({ where: { gymId: null } }),
    prisma.marketplaceVendor.findMany({ select: { id: true, name: true } }),
    prisma.gym.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name;
  return (
    <>
      <PageHeader title="Marketplace" description="Categories, commissions, listings awaiting approval, promotions and platform coupons." />
      <div className="grid-cols-1 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Commission rules" description="Most specific wins: promotion → vendor → category → gym → platform default. Shares must total 100%." action={
            <FormDialog trigger={<Button size="sm">New rule</Button>} title="Commission rule" endpoint="/api/admin/commissions" transform="admin.commission" fields={[
              { name: "name", label: "Name", required: true },
              { name: "scope", label: "Applies to", type: "select", required: true, options: ["PLATFORM_DEFAULT", "CATEGORY", "VENDOR", "GYM", "PROMOTION"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })) },
              { name: "categoryId", label: "Category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
              { name: "vendorId", label: "Vendor", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
              { name: "gymId", label: "Gym", type: "select", options: gyms.map((g) => ({ value: g.id, label: g.name })) },
              { name: "platform", label: "Platform share %", type: "number", required: true },
              { name: "gym", label: "Gym share %", type: "number", required: true },
              { name: "vendor", label: "Vendor share % (folds into gym for gym-owned listings)", type: "number", required: true },
              { name: "priority", label: "Priority", type: "number" },
              { name: "validFrom", label: "Valid from", type: "date" }, { name: "validUntil", label: "Valid until", type: "date" },
            ]} />
          } />
          <CardBody>
            <ul className="divide-y divide-line text-sm">{rules.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2.5"><span><span className="font-medium">{r.name}</span> <span className="text-ink-3">· {r.scope.replace("_", " ").toLowerCase()}{r.categoryId ? ` · ${catName(r.categoryId)}` : ""}</span></span><span className="flex items-center gap-2"><span className="num">{pct(r.platformBps)} / {pct(r.gymBps)} / {pct(r.vendorBps)}</span><ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/commissions/${r.id}`} body={{ active: !r.active }}>{r.active ? "Disable" : "Enable"}</ActionButton></span></li>)}</ul>
            <p className="mt-2 text-xs text-ink-3">Shown as platform / gym / vendor.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Categories" action={<FormDialog trigger={<Button size="sm" variant="secondary">New category</Button>} title="New category" endpoint="/api/admin/categories" transform="admin.category" fields={[{ name: "name", label: "Name", required: true }, { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "SERVICE", label: "Service" }, { value: "PRODUCT", label: "Product" }] }, { name: "sortOrder", label: "Order", type: "number" }]} />} />
          <CardBody><ul className="divide-y divide-line text-sm">{cats.map((c) => <li key={c.id} className="flex justify-between py-2"><span>{c.name} <span className="text-ink-3">· {c.kind.toLowerCase()}</span></span><span className="num text-ink-3">{c._count.products} listings</span></li>)}</ul></CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Awaiting approval" description="Vendor listings (e.g. supplements) must be approved before members can buy them." />
        <CardBody>
          {pending.length === 0 ? <p className="text-sm text-ink-3">Nothing waiting.</p> : (
            <Table><thead><tr><Th>Listing</Th><Th>Vendor</Th><Th>Gym</Th><Th className="text-right">Price</Th><Th /></tr></thead>
              <tbody>{pending.map((p) => <tr key={p.id}><Td className="font-medium">{p.name}<span className="block text-xs text-ink-3">{p.description}</span></Td><Td>{p.vendor?.name ?? "Gym"}</Td><Td>{p.gym.name}</Td><Td className="num text-right">{formatMoney(p.pricePaisa)}</Td>
                <Td className="text-right"><div className="flex justify-end gap-1"><ActionButton size="sm" method="PATCH" endpoint={`/api/admin/listings/${p.id}`} body={{ decision: "approve" }} success="Approved">Approve</ActionButton><ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/listings/${p.id}`} body={{ decision: "reject" }} success="Rejected">Reject</ActionButton></div></Td></tr>)}</tbody></Table>
          )}
        </CardBody>
      </Card>
      <div className="grid-cols-1 mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Promotions & banners" action={<FormDialog trigger={<Button size="sm" variant="secondary">New</Button>} title="Promotion" endpoint="/api/admin/promotions" transform="admin.promotion" fields={[{ name: "title", label: "Title", required: true }, { name: "subtitle", label: "Subtitle" }, { name: "gymId", label: "Only at gym", type: "select", options: gyms.map((g) => ({ value: g.id, label: g.name })) }, { name: "startsAt", label: "Starts", type: "date" }, { name: "endsAt", label: "Ends", type: "date" }, { name: "sortOrder", label: "Order", type: "number" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }]} />} />
          <CardBody><ul className="divide-y divide-line text-sm">{promos.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.title}</span><StatusPill status={p.active ? "ACTIVE" : "ARCHIVED"} /></li>)}{promos.length === 0 && <li className="text-ink-3">None.</li>}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Platform coupons" description="Marketplace-wide codes." action={<FormDialog trigger={<Button size="sm" variant="secondary">New</Button>} title="Platform coupon" endpoint="/api/admin/coupons" transform="admin.platformCoupon" fields={[{ name: "code", label: "Code", required: true }, { name: "description", label: "Description" }, { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "PERCENT", label: "Percent" }, { value: "FIXED", label: "Fixed (NPR)" }] }, { name: "value", label: "Value", type: "number", required: true }, { name: "maxRedemptions", label: "Max uses", type: "number" }, { name: "validUntil", label: "Valid until", type: "date" }]} />} />
          <CardBody><ul className="divide-y divide-line text-sm">{coupons.map((c) => <li key={c.id} className="flex justify-between py-2"><span className="num font-medium">{c.code}</span><Badge>{c.kind === "PERCENT" ? `${c.value / 100}%` : formatMoney(c.value)} · used {c.redemptions}</Badge></li>)}{coupons.length === 0 && <li className="text-ink-3">None.</li>}</ul></CardBody>
        </Card>
      </div>
    </>
  );
}
