import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Words } from "@/components/marketing/words";

export type PricingPlan = { id: string; key: string; name: string; pricePaisa: number; billingPeriod: "MONTHLY" | "YEARLY"; freeMonths: number; highlights: string[] };

/** What the plan costs per month, for pricing free months on yearly plans too. */
const monthlyPaisa = (p: PricingPlan) => (p.billingPeriod === "YEARLY" ? Math.round(p.pricePaisa / 12) : p.pricePaisa);
const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/**
 * Pricing as a climb: base camp → summit. Cards step up like a ridge, and each card's hero is its free
 * months — a big numeral and a first-year strip with the free months lit in alpenglow. Each card is driven by
 * scroll for its whole trip through the screen: it rises out of the ground turned toward the centre, lands flat
 * while fully visible (a light sheen sweeps across it), then tips away into the distance. The numeral stands
 * up and the months flip over one by one (CSS scroll timelines; a time-based stand-in where they're unsupported).
 */
export function Pricing({ plans, trialDays, footer }: { plans: PricingPlan[]; trialDays: number; footer?: React.ReactNode }) {
  const most = Math.max(0, ...plans.map((p) => p.freeMonths));
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="relative isolate overflow-clip py-24 text-[#f5f3f8] sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="pricing-h" className="kinetic display max-w-2xl text-balance text-4xl font-extrabold leading-[1.02] sm:text-6xl"><Words text="Bigger plans get more free months." /></h2>
        <p className="scroll-3d mt-5 max-w-xl text-lg text-white/75">Every new gym gets the free months of the plan it picks. After that, you pay each month in Nepali rupees. No card needed to start, and you can cancel any time.</p>

        <ol className="mt-16 grid grid-cols-1 items-start gap-5 md:grid-cols-3">
          {plans.map((p, i) => {
            const summit = p.freeMonths > 0 && p.freeMonths === most;
            const lift = (plans.length - 1 - i) * 2.5; // rem the card sits below the summit
            const fan = ((plans.length - 1) / 2 - i) * 16; // deg: outer cards turn to face the centre as they rise
            return (
              <li key={p.id} style={{ "--lift": `${lift}rem`, "--fan": `${fan}deg` } as React.CSSProperties} className={cn("plan-3d relative isolate flex flex-col overflow-clip rounded-[2rem] bg-[#1c1636]/85 p-7 ring-1 md:mt-[var(--lift)]", summit ? "shadow-[0_40px_90px_-30px_rgb(255_92_159/0.55)] ring-[#ff5c9f]/60" : "ring-white/10")}>
                {summit && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#ff5c9f,#ffb347)]" />}
                <div className="flex items-center justify-between gap-3">
                  <h3 className="display text-xl font-bold">{p.name}</h3>
                  {summit && <span className="rounded-full bg-[#ff5c9f]/15 px-3 py-1 text-xs font-semibold text-[#ffb4d3]">Most free months</span>}
                </div>

                {p.freeMonths > 0 ? (
                  <>
                    <p className="mt-6 flex items-end gap-3">
                      <span className="free-numeral display num bg-[linear-gradient(180deg,#ffd08a_0%,#ffb347_45%,#ff7a3d_100%)] bg-clip-text text-[112px] font-extrabold leading-[0.8] text-transparent">{p.freeMonths}</span>
                      <span className="pb-1 text-lg font-semibold leading-tight text-[#ffc46b]">{p.freeMonths === 1 ? "month" : "months"}<br />free</span>
                    </p>
                    <p className="mt-4 text-sm text-white/70">You save {formatMoney(p.freeMonths * monthlyPaisa(p))}. Then <span className="num font-semibold text-white">{formatMoney(p.pricePaisa)}</span> a {p.billingPeriod === "YEARLY" ? "year" : "month"}.</p>
                    <YearStrip free={p.freeMonths} />
                  </>
                ) : (
                  <>
                    <p className="mt-6"><span className="display num text-5xl font-extrabold">{formatMoney(p.pricePaisa)}</span><span className="text-white/70"> a {p.billingPeriod === "YEARLY" ? "year" : "month"}</span></p>
                    <p className="mt-2 text-sm text-white/70">Free for the first {trialDays} days.</p>
                  </>
                )}

                <ul className="mt-7 space-y-2.5 text-[15px] text-white/85">
                  {p.highlights.map((x) => (
                    <li key={x} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rotate-45 bg-[#ffb347]" />{x}</li>
                  ))}
                </ul>
                <Link
                  href={`/signup?plan=${encodeURIComponent(p.key)}`}
                  className={cn("mt-9 inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-semibold transition-[transform,background-color] active:scale-[0.98]", summit ? "bg-[#ff5c9f] text-[#1a1530] hover:bg-[#ff7ab0]" : "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15")}
                >
                  {p.freeMonths > 0 ? `Choose ${p.name} — ${months(p.freeMonths)} free` : `Choose ${p.name}`}
                </Link>
              </li>
            );
          })}
        </ol>
        {footer}
      </div>
    </section>
  );
}

/** The first year, month by month: free months glow, paid months are outlines. */
function YearStrip({ free }: { free: number }) {
  return (
    <div className="mt-6">
      <ol aria-label={`Your first 12 months: ${free >= 12 ? "all free" : free === 1 ? "month 1 free, then paid" : `months 1–${free} free, then paid`}`} className="grid grid-cols-12 gap-1" style={{ perspective: "500px" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <li
            key={i}
            aria-hidden
            style={{ "--i": i } as React.CSSProperties}
            className={cn("month-cell h-7 rounded-md", i < free ? "bg-[linear-gradient(180deg,#ffc46b,#ff7a3d)] shadow-[0_0_14px_-2px_rgb(255_138_61/0.7)]" : "ring-1 ring-inset ring-white/15")}
          />
        ))}
      </ol>
      <div aria-hidden className="mt-1.5 flex justify-between text-[11px] text-white/60"><span>Month 1</span><span>Month 12</span></div>
    </div>
  );
}
