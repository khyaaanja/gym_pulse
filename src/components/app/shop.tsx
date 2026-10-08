"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, ShoppingBag, Dumbbell, Package, Salad, Pill, Shirt, Flower2, Swords, Users, HeartPulse } from "lucide-react";

const ART: [RegExp, typeof Dumbbell][] = [[/yoga|stretch|pilates/i, Flower2], [/box|martial|mma/i, Swords], [/diet|nutrition|meal/i, Salad], [/supplement|protein/i, Pill], [/merch|apparel|wear|shirt/i, Shirt], [/class|group/i, Users], [/assess|health|physio/i, HeartPulse], [/train|pt\b|coach/i, Dumbbell]];
const TINTS = ["bg-brand-soft text-brand", "bg-ok-soft text-ok", "bg-warn-soft text-warn", "bg-risk-soft text-risk", "bg-lost-soft text-lost"];
function art(category: string, name: string, kind: string) {
  const Icon = ART.find(([re]) => re.test(category) || re.test(name))?.[1] ?? (kind === "SERVICE" ? Dumbbell : Package);
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { Icon, tint: TINTS[h % TINTS.length]! };
}
import { Button } from "@/components/ui/button";
import { PolicyNote } from "@/components/legal/policy-note";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/fields";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ShopItem = { id: string; name: string; description: string | null; kind: "PRODUCT" | "SERVICE"; pricePaisa: number; compareAtPaisa: number | null; inventory: number | null; sessionCount: number | null; categoryId: string; category: string; featured: boolean; imageUrl: string | null; vendor: string | null; includes?: string[] };
type Instruction = { type: "redirect"; url: string } | { type: "form"; url: string; fields: Record<string, string> };

export function Shop({ items, categories, providers, symbol, focus }: { items: ShopItem[]; categories: { id: string; name: string }[]; providers: { key: string; name: string }[]; symbol: string; focus?: string }) {
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<ShopItem | null>(items.find((i) => i.id === focus) ?? null);
  const [cartOpen, setCartOpen] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [provider, setProvider] = useState(providers[0]?.key);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => (cat === "all" ? items : items.filter((i) => i.categoryId === cat)), [cat, items]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ item: items.find((i) => i.id === id)!, q }));
  const total = lines.reduce((a, l) => a + l.item.pricePaisa * l.q, 0);
  const count = lines.reduce((a, l) => a + l.q, 0);
  const add = (i: ShopItem, d = 1) => setCart((c) => ({ ...c, [i.id]: Math.max(0, Math.min(i.inventory ?? 20, (c[i.id] ?? 0) + d)) }));

  async function checkout() {
    if (!provider) return;
    setBusy(true);
    try {
      const o = await api<{ orderId: string }>("/api/me/orders", { body: { items: lines.map((l) => ({ productId: l.item.id, quantity: l.q })), couponCode: coupon || null } });
      const r = await api<{ instruction: Instruction }>(`/api/me/orders/${o.orderId}/pay`, { body: { provider } });
      const i = r.instruction;
      if (i.type === "redirect") window.location.assign(i.url);
      else {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = i.url;
        Object.entries(i.fields).forEach(([k, v]) => { const x = document.createElement("input"); x.type = "hidden"; x.name = k; x.value = v; form.appendChild(x); });
        document.body.appendChild(form);
        form.submit();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't place the order.");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
        {[{ id: "all", name: "All" }, ...categories].map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className={cn("h-10 shrink-0 rounded-full px-4 text-sm font-medium ring-1", cat === c.id ? "bg-ink text-mist ring-ink" : "bg-surface text-ink-2 ring-line")}>{c.name}</button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {shown.map((i) => (
          <button key={i.id} onClick={() => setOpen(i)} className="group overflow-hidden rounded-3xl bg-surface text-left shadow-card ring-1 ring-line/60 transition-shadow hover:shadow-lift">
            {i.imageUrl ? (
              <div className="aspect-[4/3] bg-surface-2"><img src={i.imageUrl} alt="" className="size-full object-cover" /></div>
            ) : (
              ((a) => (
                <div className={cn("relative grid aspect-[4/3] place-items-center overflow-hidden", a.tint)} aria-hidden>
                  <a.Icon className="size-10 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.6} />
                  <a.Icon className="absolute -bottom-6 -right-6 size-28 opacity-10" strokeWidth={1.2} />
                </div>
              ))(art(i.category, i.name, i.kind))
            )}
            <div className="p-3.5">
              <p className="text-xs text-ink-3">{i.category}{i.featured ? " · Featured" : ""}</p>
              <p className="mt-0.5 line-clamp-2 font-medium leading-snug">{i.name}</p>
              <p className="num mt-2 font-semibold">{formatMoney(i.pricePaisa, symbol)}{i.compareAtPaisa && i.compareAtPaisa > i.pricePaisa ? <span className="ml-2 text-sm font-normal text-ink-3 line-through">{formatMoney(i.compareAtPaisa, symbol)}</span> : null}</p>
              {i.includes && <p className="mt-1 text-xs text-ink-3">Includes {i.includes.join(", ")}{i.compareAtPaisa && i.compareAtPaisa > i.pricePaisa ? ` · save ${formatMoney(i.compareAtPaisa - i.pricePaisa, symbol)}` : ""}</p>}
              {i.inventory !== null && i.inventory <= 0 && <p className="mt-1 text-xs text-risk">Out of stock</p>}
            </div>
          </button>
        ))}
      </div>

      {count > 0 && (
        <Button size="lg" className="fixed bottom-24 right-4 z-30 shadow-lift lg:bottom-8" onClick={() => setCartOpen(true)}>
          <ShoppingBag /> Cart · {count} · {formatMoney(total, symbol)}
        </Button>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent title={open.name} description={`${open.category}${open.vendor ? ` · sold by ${open.vendor}` : ""}`}>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{open.description ?? (open.includes ? "" : "No description.")}</p>
            {open.includes && <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] text-ink-2">{open.includes.map((x) => <li key={x}>{x}</li>)}</ul>}
            {open.sessionCount && <p className="mt-3 text-sm text-ink-3">{open.sessionCount} session{open.sessionCount === 1 ? "" : "s"}. A trainer will contact you to schedule after purchase.</p>}
            <div className="mt-6 flex items-center justify-between">
              <span className="display num text-2xl font-semibold">{formatMoney(open.pricePaisa, symbol)}</span>
              <Button disabled={open.inventory !== null && open.inventory <= (cart[open.id] ?? 0)} onClick={() => { add(open); setOpen(null); toast.success("Added to cart"); }}>Add to cart</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent title="Your cart" side="right">
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.item.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{l.item.name}</p><p className="num text-sm text-ink-3">{formatMoney(l.item.pricePaisa, symbol)}</p></div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" aria-label="Remove one" onClick={() => add(l.item, -1)}><Minus /></Button>
                  <span className="num w-6 text-center">{l.q}</span>
                  <Button size="icon" variant="ghost" aria-label="Add one" onClick={() => add(l.item, 1)}><Plus /></Button>
                </div>
              </li>
            ))}
          </ul>
          <Input className="mt-4" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code (optional)" aria-label="Coupon code" />
          {providers.length === 0 ? <p className="mt-4 rounded-2xl bg-warn-soft p-3 text-sm text-warn">Online payment isn&apos;t set up at your gym yet.</p> : (
            <div className="mt-4 flex flex-wrap gap-2">
              {providers.map((p) => <button key={p.key} onClick={() => setProvider(p.key)} aria-pressed={provider === p.key} className={cn("h-10 rounded-xl px-3 text-sm font-medium ring-1", provider === p.key ? "bg-ink text-mist ring-ink" : "ring-line")}>{p.name}</button>)}
            </div>
          )}
          <div className="mt-6 flex justify-between text-lg font-semibold"><span>Total</span><span className="num">{formatMoney(total, symbol)}</span></div>
          <p className="mt-1 text-xs text-ink-3">Coupon discounts are applied at checkout.</p>
          <Button size="lg" className="mt-4 w-full" disabled={busy || !providers.length} onClick={checkout}>{busy ? "Opening payment…" : "Pay now"}</Button>
          <PolicyNote kind="shop" className="mt-3" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
