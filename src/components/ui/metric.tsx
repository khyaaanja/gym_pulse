import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

/** A dashboard figure. Every metric states its period and definition; estimates are labelled as such. */
export function Metric({ label, value, period, definition, trend, estimate, className, href }: { label: string; value: React.ReactNode; period?: string; definition?: string; trend?: { text: string; good?: boolean } | null; estimate?: boolean; className?: string; href?: string }) {
  const Comp = href ? "a" : "div";
  return (
    // The first-load hand-off script (motion/handoff.ts) may add data-risen/data-landed before hydration.
    <Comp href={href} suppressHydrationWarning className={cn("scroll-3d group block rounded-[var(--radius-card)] bg-surface p-5 shadow-card ring-1 ring-line/70", href && "transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        {estimate && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">Estimate</span>}
      </div>
      <p className="display num mt-2.5 text-[30px] font-bold leading-none tracking-tight">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        {trend && <span className={trend.good === undefined ? "" : trend.good ? "text-ok" : "text-risk"}>{trend.text}</span>}
        {period && <span>{period}</span>}
        {definition && (
          <span className="inline-flex items-center gap-1" title={definition}>
            <Info className="size-3.5" aria-hidden />
            <span className="sr-only">{definition}</span>
          </span>
        )}
      </div>
    </Comp>
  );
}
