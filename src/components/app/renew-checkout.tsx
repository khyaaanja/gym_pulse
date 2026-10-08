"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PolicyNote } from "@/components/legal/policy-note";
import { Input } from "@/components/ui/fields";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Plan = { id: string; name: string; description: string | null; durationDays: number; pricePaisa: number };
type Provider = { key: string; name: string };
type Instruction = { type: "redirect"; url: string } | { type: "form"; url: string; fields: Record<string, string> };

/** Plan → coupon → provider → hand-off to the provider. Success is only ever shown after the server verifies it. */
/** `initialCoupon` (from an offer link) is filled in and applied once on arrival; the server still validates it. */
export function RenewCheckout({ plans, providers, currentPlanId, symbol, initialCoupon, firstTime }: { plans: Plan[]; providers: Provider[]; currentPlanId: string | null; symbol: string; initialCoupon?: string; firstTime?: boolean }) {
  const [planId, setPlanId] = useState(currentPlanId && plans.some((p) => p.id === currentPlanId) ? currentPlanId : plans[0]?.id);
  const [provider, setProvider] = useState(providers[0]?.key);
  const [coupon, setCoupon] = useState(initialCoupon ?? "");
  const [discount, setDiscount] = useState<{ code: string; paisa: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === planId);

  async function applyCoupon() {
    if (!plan || !coupon.trim()) return;
    try {
      const r = await api<{ code: string; discountPaisa: number }>("/api/me/coupon", { body: { code: coupon, scope: "MEMBERSHIP", amountPaisa: plan.pricePaisa } });
      setDiscount({ code: r.code, paisa: r.discountPaisa });
      toast.success(`Coupon ${r.code} applied`);
    } catch (e) {
      setDiscount(null);
      toast.error(e instanceof ApiError ? e.message : "That coupon isn't valid.");
    }
  }

  const autoApplied = useRef(false);
  useEffect(() => {
    if (!initialCoupon || autoApplied.current) return;
    autoApplied.current = true;
    void applyCoupon();
  }, [initialCoupon]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    if (!plan || !provider) return;
    setBusy(true);
    try {
      const r = await api<{ instruction: Instruction }>("/api/me/renew", { body: { planId: plan.id, provider, couponCode: discount?.code ?? null } });
      const i = r.instruction;
      if (i.type === "redirect") window.location.assign(i.url);
      else {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = i.url;
        for (const [k, v] of Object.entries(i.fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = v;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Payment couldn't be started. Please try again.");
      setBusy(false);
    }
  }

  if (!plans.length) return <p className="text-sm text-ink-3">No plans are available online right now. Please ask at the front desk.</p>;
  const total = plan ? plan.pricePaisa - (discount?.paisa ?? 0) : 0;

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">Choose a plan</legend>
        <div className="grid-cols-1 grid gap-2 sm:grid-cols-2">
          {plans.map((p) => (
            <label key={p.id} className={cn("cursor-pointer rounded-2xl p-4 ring-1 transition-shadow", planId === p.id ? "bg-brand-soft ring-2 ring-brand" : "bg-surface ring-line hover:shadow-card")}>
              <input type="radio" name="plan" value={p.id} checked={planId === p.id} onChange={() => { setPlanId(p.id); setDiscount(null); }} className="sr-only" />
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="num font-semibold">{formatMoney(p.pricePaisa, symbol)}</span>
              </span>
              <span className="mt-1 block text-sm text-ink-3">{p.description ?? `${p.durationDays} days`}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code (optional)" aria-label="Coupon code" />
        <Button variant="secondary" onClick={applyCoupon} disabled={!coupon.trim()}>Apply</Button>
      </div>

      {providers.length === 0 ? (
        <p className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">Online payment isn&apos;t set up at your gym yet. You can renew at the front desk.</p>
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">Pay with</legend>
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <button key={p.key} type="button" onClick={() => setProvider(p.key)} aria-pressed={provider === p.key} className={cn("h-11 rounded-2xl px-4 text-sm font-medium ring-1", provider === p.key ? "bg-ink text-mist ring-ink" : "bg-surface ring-line")}>
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="rounded-2xl bg-mist p-4 text-sm">
        <div className="flex justify-between"><span>{plan?.name}</span><span className="num">{formatMoney(plan?.pricePaisa ?? 0, symbol)}</span></div>
        {discount && <div className="mt-1 flex justify-between text-ok"><span>Coupon {discount.code}</span><span className="num">−{formatMoney(discount.paisa, symbol)}</span></div>}
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="num">{formatMoney(total, symbol)}</span></div>
      </div>

      <Button size="lg" className="h-16 w-full text-lg" onClick={pay} disabled={busy || !providers.length}>{busy ? "Opening payment…" : firstTime ? "Pay now" : "Renew now"}</Button>
      <p className="text-center text-xs text-ink-3">Your membership is extended only after the payment provider confirms the payment.</p>
      <PolicyNote kind="renew" />
    </div>
  );
}
