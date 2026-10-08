import { cn } from "@/lib/utils";

/**
 * The signature element: an ECG-style trace built from real daily visit counts.
 * Each day becomes a small beat whose height is that day's attendance. Drawn once on load.
 */
export function PulseTrace({ values, height = 56, className, tone = "var(--brand)", label }: { values: number[]; height?: number; className?: string; tone?: string; label?: string }) {
  if (values.length < 2) return null;
  const w = 600;
  const max = Math.max(1, ...values);
  const step = w / values.length;
  const mid = height * 0.62;
  let d = `M0 ${mid}`;
  values.forEach((v, i) => {
    const x = i * step;
    const amp = (v / max) * (height * 0.55);
    // flat → small dip → spike proportional to the day's visits → back to baseline
    d += ` L${x + step * 0.25} ${mid} L${x + step * 0.35} ${mid + amp * 0.18} L${x + step * 0.5} ${mid - amp} L${x + step * 0.62} ${mid + amp * 0.3} L${x + step * 0.75} ${mid}`;
  });
  d += ` L${w} ${mid}`;
  return (
    // The wrapper is the clip: it and the trace slide in opposite directions, so the trace stays put while the clip edge
    // sweeps across it (globals.css). Transforms only, so the draw-on runs on the compositor through hydration.
    <span className={cn("pulse-trace block overflow-clip", className)}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={label ?? "Daily attendance trace"}>
        <path d={d} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

/** Small per-member sparkline: visits in the previous vs. last 30 days as two bars. */
export function TrendBars({ prev, last }: { prev: number; last: number }) {
  const max = Math.max(1, prev, last);
  const down = last < prev;
  return (
    <span role="img" className="inline-flex items-end gap-0.5" aria-label={`${prev} visits previous 30 days, ${last} visits last 30 days`}>
      <span className="w-1.5 rounded-sm bg-ink-3/40" style={{ height: `${6 + (prev / max) * 16}px` }} />
      <span className={`w-1.5 rounded-sm ${down ? "bg-risk" : "bg-ok"}`} style={{ height: `${6 + (last / max) * 16}px` }} />
    </span>
  );
}
