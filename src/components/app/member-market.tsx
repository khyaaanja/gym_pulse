import type { MemberContext } from "@/lib/api";
import { prisma } from "@/db/client";
import { availableProviders } from "@/services/payments/service";
import { bundleAvailability, contextualSuggestion } from "@/services/marketplace";
import { gymSettings } from "@/config/gym-settings";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Shop } from "./shop";

export async function MemberMarket({ ctx, focus }: { ctx: MemberContext; focus?: string }) {
  const [products, providers, orders, bookings, promos] = await Promise.all([
    ctx.db.marketplaceProduct.findMany({ where: { status: "ACTIVE", isBundle: false, OR: [{ vendorId: null }, { vendor: { status: "APPROVED" } }] }, include: { category: true, vendor: { select: { name: true } } }, orderBy: [{ featured: "desc" }, { name: "asc" }] }),
    ctx.flags.payments ? availableProviders(ctx.gym.id) : Promise.resolve([]),
    ctx.db.marketplaceOrder.findMany({ where: { memberId: ctx.member.id, status: { not: "PENDING_PAYMENT" } }, include: { items: true }, orderBy: { placedAt: "desc" }, take: 10 }),
    ctx.db.booking.findMany({ where: { memberId: ctx.member.id }, include: { trainer: { include: { user: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.promotion.findMany({ where: { active: true, OR: [{ gymId: null }, { gymId: ctx.gym.id }] }, orderBy: { sortOrder: "asc" }, take: 3 }),
  ]);
  const bundles = await ctx.db.marketplaceProduct.findMany({ where: { status: "ACTIVE", isBundle: true, bundleItems: { some: {}, none: { product: { status: "ARCHIVED" } } } }, include: { category: true, bundleItems: { include: { product: { select: { name: true, inventory: true } } } } } });
  const suggestion = gymSettings(ctx.gym.settings).marketplace.contextualSuggestions ? await contextualSuggestion(ctx.gym.id, ctx.member.currentStreak) : null;
  const all = [...products.map((p) => ({ ...p, includes: undefined as string[] | undefined })), ...bundles.map((b) => ({ ...b, vendor: null, inventory: bundleAvailability(b.bundleItems), includes: b.bundleItems.map((i) => `${i.product.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`) }))];
  const cats = [...new Map(all.map((p) => [p.categoryId, { id: p.categoryId, name: p.category.name }])).values()];
  const names: Record<string, string> = { sandbox: "Test gateway", esewa: "eSewa", khalti: "Khalti" };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-semibold">Grow with {ctx.gym.name}</h1>
        <p className="mt-1 text-ink-3">Training, classes and gear from your gym.</p>
      </div>
      {suggestion && <Card className="bg-brand-soft ring-brand/20"><CardBody><p className="text-[15px]">{suggestion.message}</p></CardBody></Card>}
      {promos.map((p) => <Card key={p.id}><CardBody><p className="font-semibold">{p.title}</p>{p.subtitle && <p className="text-sm text-ink-2">{p.subtitle}</p>}</CardBody></Card>)}
      <Shop
        items={all.map((p) => ({ id: p.id, name: p.name, description: p.description, kind: p.kind, pricePaisa: p.pricePaisa, compareAtPaisa: p.compareAtPaisa, inventory: p.inventory, sessionCount: p.sessionCount, categoryId: p.categoryId, category: p.category.name, featured: p.featured, imageUrl: p.imageFileId ? `/api/files/${p.imageFileId}` : null, vendor: p.vendor?.name ?? null, includes: p.includes }))}
        categories={cats}
        providers={providers.map((p) => ({ key: p.key, name: names[p.key] ?? p.displayName }))}
        symbol={ctx.gym.currencySymbol}
        focus={focus}
      />
      {(orders.length > 0 || bookings.length > 0) && (
        <div className="grid-cols-1 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="My orders" />
            <CardBody>
              <ul className="divide-y divide-line text-sm">
                {orders.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2.5"><span className="min-w-0 truncate">{o.items.map((i) => i.name).join(", ")}</span><span className="flex shrink-0 items-center gap-2"><StatusPill status={o.status} /><span className="num">{formatMoney(o.totalPaisa, ctx.gym.currencySymbol)}</span></span></li>)}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="My bookings" />
            <CardBody>
              <ul className="divide-y divide-line text-sm">
                {bookings.map((b) => <li key={b.id} className="py-2.5"><div className="flex justify-between gap-2"><span className="font-medium">{b.title}</span><StatusPill status={b.status} /></div><p className="text-ink-3">{b.sessionsUsed}/{b.sessionsTotal} sessions used{b.trainer ? ` · ${b.trainer.user.name}` : ""}{b.scheduledAt ? ` · next ${b.scheduledAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.gym.timezone })}` : ""}</p></li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
