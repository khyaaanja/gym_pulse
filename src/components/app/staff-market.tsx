import Link from "next/link";
import type { GymContext } from "@/lib/api";
import { prisma } from "@/db/client";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { ImageUpload } from "./image-upload";
import { bundleAvailability } from "@/services/marketplace";

export async function StaffMarket({ ctx, tab }: { ctx: GymContext; tab: string }) {
  const sym = ctx.gym.currencySymbol;
  const canManage = ctx.can("marketplace.manage");
  const [products, orders, categories, trainers, coupons] = await Promise.all([
    ctx.db.marketplaceProduct.findMany({ include: { category: true, vendor: { select: { name: true } }, bundleItems: { include: { product: { select: { name: true, inventory: true } } } } }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    // Orders name members and what they bought: managers only. Trainers reach this page through bookings.manage and
    // see the catalogue; their sessions are on the Bookings page.
    canManage ? ctx.db.marketplaceOrder.findMany({ include: { member: { select: { id: true, fullName: true } }, items: true }, orderBy: { placedAt: "desc" }, take: 50 }) : Promise.resolve([]),
    prisma.marketplaceCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.db.staffMember.findMany({ where: { role: "TRAINER", active: true }, include: { user: { select: { name: true } } } }),
    ctx.can("payments.manage") ? prisma.coupon.findMany({ where: { gymId: ctx.gym.id }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const productFields = (p?: (typeof products)[number]): FieldSpec[] => [
    ...(p ? [] : [{ name: "categoryId", label: "Category", type: "select" as const, required: true, options: categories.map((c) => ({ value: c.id, label: `${c.name} (${c.kind === "SERVICE" ? "service" : "product"})` })) }]),
    { name: "name", label: "Name", required: true, defaultValue: p?.name },
    { name: "description", label: "Description", type: "textarea", defaultValue: p?.description },
    { name: "priceRupees", label: "Price (NPR)", type: "number", required: true, defaultValue: p ? p.pricePaisa / 100 : undefined },
    ...(p ? [] : [{ name: "sessionCount", label: "Sessions included (services)", type: "number" as const }, { name: "trainerId", label: "Trainer (services)", type: "select" as const, options: trainers.map((t) => ({ value: t.id, label: t.user.name })) }]),
    { name: "inventory", label: "Stock (products)", type: "number", defaultValue: p?.inventory, hint: "Leave empty for services." },
    { name: "suggestAtStreak", label: "Suggest to members from streak", type: "number", defaultValue: p?.suggestAtStreak, hint: "Optional. We show a single, honest suggestion — never a countdown or pressure." },
    { name: "featured", label: "Featured", type: "checkbox", defaultValue: p?.featured },
    { name: "status", label: "Status", type: "select", required: true, defaultValue: p?.status === "PENDING_APPROVAL" ? "ACTIVE" : p?.status ?? "ACTIVE", options: [{ value: "ACTIVE", label: p?.status === "PENDING_APPROVAL" ? "Approve & publish" : "Published" }, { value: "DRAFT", label: "Draft" }, { value: "ARCHIVED", label: "Archived" }] },
  ];
  const bundleable = products.filter((p) => !p.isBundle && !p.vendorId && p.status !== "ARCHIVED" && p.status !== "PENDING_APPROVAL");
  const bundleFields: FieldSpec[] = [
    { name: "name", label: "Bundle name", required: true, placeholder: "New member starter pack" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "categoryId", label: "Category", type: "select", required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
    ...bundleable.map((p) => ({ name: `i_${p.id}`, label: `${p.name} — ${formatMoney(p.pricePaisa, sym)}`, type: "checkbox" as const })),
    { name: "priceRupees", label: "Bundle price (NPR)", type: "number", required: true, hint: "Must be less than the items cost separately. Stock follows the items." },
    { name: "featured", label: "Featured", type: "checkbox" },
  ];
  const tabs = [{ k: "products", l: "Listings" }, ...(canManage ? [{ k: "orders", l: "Orders" }] : []), ...(ctx.can("payments.manage") ? [{ k: "coupons", l: "Coupons" }] : [])];

  return (
    <>
      <PageHeader title="Marketplace" description="Grow member revenue with training packs, classes and gear." actions={canManage && tab === "products" ? (
        <div className="flex flex-wrap gap-2">
          {bundleable.length >= 2 && <FormDialog trigger={<Button variant="secondary">Create bundle</Button>} title="New bundle" description="Tick two or more listings to sell together at a lower price." endpoint="/api/gym/products/bundles" fields={bundleFields} successMessage="Bundle created" transform="gym.bundle" />}
          <FormDialog trigger={<Button>Add listing</Button>} title="New listing" endpoint="/api/gym/products" fields={productFields()} successMessage="Listing added" transform="gym.product" />
        </div>
      ) : undefined} />
      <div className="mb-5 flex gap-2">
        {tabs.map((t) => <Link key={t.k} href={`/app/marketplace?tab=${t.k}`} className={`h-10 rounded-full px-4 py-2 text-sm font-medium ring-1 ${tab === t.k ? "bg-ink text-mist ring-ink" : "bg-surface text-ink-2 ring-line"}`}>{t.l}</Link>)}
      </div>

      {tab === "products" && (
        <Card><CardBody>
          <Table>
            <thead><tr><Th>Listing</Th><Th>Category</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th><Th /></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <Td><span className="font-medium">{p.name}</span>{p.isBundle && <Badge tone="ok" className="ml-2">Bundle</Badge>}{p.featured && <Badge tone="brand" className="ml-2">Featured</Badge>}{p.vendor && <span className="block text-xs text-ink-3">Vendor: {p.vendor.name}</span>}{p.isBundle && <span className="block text-xs text-ink-3">Includes {p.bundleItems.map((b) => `${b.product.name}${b.quantity > 1 ? ` ×${b.quantity}` : ""}`).join(", ")}{p.compareAtPaisa ? ` · ${formatMoney(p.compareAtPaisa, sym)} separately` : ""}</span>}</Td>
                  <Td className="text-ink-2">{p.category.name}</Td>
                  <Td><StatusPill status={p.status} /></Td>
                  <Td className="num text-right">{formatMoney(p.pricePaisa, sym)}</Td>
                  <Td className="num text-right">{p.isBundle ? (bundleAvailability(p.bundleItems) ?? "—") : p.inventory ?? "—"}</Td>
                  <Td className="text-right">
                    {canManage && <div className="flex justify-end gap-1">
                      <ImageUpload productId={p.id} />
                      <FormDialog trigger={<Button size="sm" variant={p.status === "PENDING_APPROVAL" ? "primary" : "ghost"}>{p.status === "PENDING_APPROVAL" ? "Review" : "Edit"}</Button>} title={p.name} endpoint={`/api/gym/products/${p.id}`} method="PATCH" fields={productFields(p)} transform="gym.product" />
                    </div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody></Card>
      )}

      {tab === "orders" && (
        <Card><CardBody>
          <Table>
            <thead><tr><Th>Order</Th><Th>Member</Th><Th>Items</Th><Th>Status</Th><Th className="text-right">Total</Th><Th /></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <Td className="num whitespace-nowrap">{o.number}<span className="block text-xs text-ink-3">{o.placedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></Td>
                  <Td><Link href={`/app/members/${o.member.id}`} className="hover:underline">{o.member.fullName}</Link></Td>
                  <Td className="text-ink-2">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</Td>
                  <Td><StatusPill status={o.status} /></Td>
                  <Td className="num text-right">{formatMoney(o.totalPaisa, sym)}</Td>
                  <Td className="text-right">{o.status === "PAID" && canManage && <ActionButton size="sm" variant="secondary" endpoint={`/api/gym/orders/${o.id}`} success="Marked fulfilled">Mark fulfilled</ActionButton>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody></Card>
      )}

      {tab === "coupons" && (
        <Card>
          <CardHeader title="Coupons" action={
            <FormDialog trigger={<Button size="sm">New coupon</Button>} title="New coupon" endpoint="/api/gym/coupons" transform="gym.coupon" transformArgs={{ tz: ctx.gym.timezone }} successMessage="Coupon created" fields={[
              { name: "code", label: "Code", required: true, placeholder: "DASHAIN10" },
              { name: "description", label: "Description" },
              { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "PERCENT", label: "Percent off" }, { value: "FIXED", label: "Fixed amount off (NPR)" }] },
              { name: "value", label: "Value", type: "number", required: true, hint: "10 = 10% or Rs. 10 depending on type." },
              { name: "appliesTo", label: "Applies to", type: "select", required: true, options: [{ value: "ALL", label: "Memberships and marketplace" }, { value: "MEMBERSHIP", label: "Memberships" }, { value: "MARKETPLACE", label: "Marketplace" }] },
              { name: "maxRedemptions", label: "Maximum uses", type: "number" },
              { name: "validUntil", label: "Valid until", type: "date" },
            ]} />
          } />
          <CardBody>
            <Table>
              <thead><tr><Th>Code</Th><Th>Discount</Th><Th>Used</Th><Th>Valid until</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <Td className="num font-medium">{c.code}</Td>
                    <Td>{c.kind === "PERCENT" ? `${c.value / 100}%` : formatMoney(c.value, sym)}</Td>
                    <Td className="num">{c.redemptions}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""}</Td>
                    <Td>{c.validUntil ? formatDate(c.validUntil, undefined, ctx.gym.timezone) : "—"}</Td>
                    <Td><StatusPill status={c.active ? "ACTIVE" : "ARCHIVED"} /></Td>
                    <Td className="text-right"><ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/coupons/${c.id}`} body={{ active: !c.active }}>{c.active ? "Disable" : "Enable"}</ActionButton></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
