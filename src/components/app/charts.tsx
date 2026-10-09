"use client";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

/**
 * The app's two charts, drawn as plain SVG. They replaced Recharts, which was ~370 KB of JS whose evaluation alone
 * held a phone's main thread for over a second on the dashboard. These draw in well under a millisecond.
 */

const PAD = { top: 8, right: 8, bottom: 24 } as const;
const FONT = 12;
// Rough width of a 12 px label character, for spacing ticks without measuring text.
const CHAR_W = 6.6;

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const compact = (v: number) => (v >= 100000 ? `${+(v / 100000).toFixed(1)}L` : v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));

/** Up to ~4 evenly spaced round ticks from 0 to at least `max`. Whole numbers only. */
function ticks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? 10 * mag);
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) out.push(Math.round(v));
  return out;
}

/** Monotone cubic through the points (the curve d3 calls monotoneX): smooth, and never overshoots the data. */
function monotone(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!, [x2, y2] = pts[i + 1]!;
    const h0 = x1 - x0, h1 = x2 - x1;
    const s0 = (y1 - y0) / h0, s1 = (y2 - y1) / h1, p = (s0 * h1 + s1 * h0) / (h0 + h1);
    m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const end = (a: [number, number], b: [number, number], t: number) => (3 * (b[1] - a[1])) / (b[0] - a[0]) / 2 - t / 2;
  m[0] = n > 2 ? end(pts[0]!, pts[1]!, m[1]!) : (pts[1]![1] - pts[0]![1]) / (pts[1]![0] - pts[0]![0]);
  m[n - 1] = n > 2 ? end(pts[n - 2]!, pts[n - 1]!, m[n - 2]!) : m[0]!;
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const dx = (x1 - x0) / 3;
    d += `C${x0 + dx},${y0 + dx * m[i - 1]!},${x1 - dx},${y1 - dx * m[i]!},${x1},${y1}`;
  }
  return d;
}

/** Tracks the box's width; 0 until measured (on the server and before the first layout). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * The highlighted point or bar. A mouse clears it on leaving the chart; a finger lifts straight after a tap, so a
 * tapped point stays highlighted until the next tap anywhere outside the chart.
 */
function useHover(box: RefObject<HTMLDivElement | null>) {
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (hover === null) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setHover(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hover, box]);
  const leave = (e: PointerEvent) => { if (e.pointerType !== "touch") setHover(null); };
  return [hover, setHover, leave] as const;
}

function Tip({ x, y, w, title, children }: { x: number; y: number; w: number; title: string; children: ReactNode }) {
  // Sits right of the pointer, or left of it near the right edge, like the old tooltip.
  const right = x > w - 150;
  return (
    <div
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl bg-surface px-3 py-2 text-sm shadow-card ring-1 ring-line"
      style={{ left: x, top: y, transform: `translate(${right ? "calc(-100% - 12px)" : "12px"}, -50%)` }}
    >
      <p className="text-xs text-ink-3">{title}</p>
      <p className="num font-semibold text-ink">{children}</p>
    </div>
  );
}

function Frame({ height, label, box, children }: { height: number; label: string; box: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={box} className="relative select-none" style={{ height, touchAction: "pan-y" }} role="img" aria-label={label}>
      {children}
    </div>
  );
}

function YAxis({ ticks: ts, y, left, w, format }: { ticks: number[]; y: (v: number) => number; left: number; w: number; format: (v: number) => string }) {
  return ts.map((t) => (
    <g key={t}>
      <line x1={left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
      <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={FONT} fill="var(--ink-3)">{format(t)}</text>
    </g>
  ));
}

/** Single series: daily check-ins. No legend (the title names it); crosshair tooltip on hover or touch. */
export function AttendanceChart({ data, height = 220 }: { data: { date: string; visits: number }[]; height?: number }) {
  const [box, w] = useWidth();
  const [hover, setHover, leave] = useHover(box);
  // useId's punctuation isn't safe inside url(#…).
  const fill = `att${useId().replace(/[^\w-]/g, "")}`;
  const label = `Daily check-ins, ${data.length} days`;
  if (!w || data.length === 0) return <Frame box={box} height={height} label={label}>{null}</Frame>;

  const left = 36;
  const ts = ticks(Math.max(0, ...data.map((d) => d.visits)));
  const top = ts.at(-1)!;
  const plotW = w - left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => left + (data.length === 1 ? plotW / 2 : (i * plotW) / (data.length - 1));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.visits)] as [number, number]);
  const line = monotone(pts);
  const area = `${line}L${pts.at(-1)![0]},${y(0)}L${pts[0]![0]},${y(0)}Z`;
  // Label every k-th day so labels keep a gap between them.
  const per = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const every = Math.max(1, Math.ceil((CHAR_W * 7 + 28) / per));

  const pick = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - left) / plotW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? data[hover] : null;

  return (
    <Frame box={box} height={height} label={label}>
      <svg width={w} height={height} className="block overflow-visible" onPointerMove={pick} onPointerDown={pick} onPointerLeave={leave}>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis ticks={ts} y={y} left={left} w={w} format={String} />
        {data.map((d, i) => (i % every === 0 ? (
          <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" fontSize={FONT} fill="var(--ink-3)">{dayLabel(d.date)}</text>
        ) : null))}
        <path d={area} fill={`url(#${fill})`} />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(hover)} cy={pts[hover]![1]} r={5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      {h && <Tip x={x(hover!)} y={pts[hover!]![1]} w={w} title={dayLabel(h.date)}>{h.visits.toLocaleString("en-IN")} check-ins</Tip>}
    </Frame>
  );
}

/** Single-hue bars for magnitude (e.g. revenue by stream). Labels are the categories; values in the tooltip. */
export function MagnitudeBars({ data, unit, height = 220 }: { data: { label: string; value: number }[]; unit: string; height?: number }) {
  const [box, w] = useWidth();
  const [hover, setHover, leave] = useHover(box);
  const label = data.map((d) => `${d.label}: ${d.value}`).join(", ");
  if (!w || data.length === 0) return <Frame box={box} height={height} label={label}>{null}</Frame>;

  const left = 44;
  const ts = ticks(Math.max(0, ...data.map((d) => d.value)));
  const top = ts.at(-1)!;
  const plotW = w - left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const gap = Math.min(18, band * 0.2);
  const barW = Math.min(48, Math.max(1, band - gap * 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const cx = (i: number) => left + band * i + band / 2;
  // Category labels that don't fit their band are thinned out rather than overlapped.
  const widest = Math.max(...data.map((d) => d.label.length)) * CHAR_W + 8;
  const every = Math.max(1, Math.ceil(widest / band));

  const pick = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - left) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };
  const h = hover !== null ? data[hover] : null;
  const r = Math.min(4, barW / 2);

  return (
    <Frame box={box} height={height} label={label}>
      <svg width={w} height={height} className="block overflow-visible" onPointerMove={pick} onPointerDown={pick} onPointerLeave={leave}>
        {hover !== null && <rect x={left + band * hover} y={PAD.top} width={band} height={plotH} fill="var(--surface-2)" />}
        <YAxis ticks={ts} y={y} left={left} w={w} format={compact} />
        {data.map((d, i) => {
          const bh = Math.max(0, y(0) - y(d.value));
          const x0 = cx(i) - barW / 2, y0 = y(d.value), rr = Math.min(r, bh);
          return (
            <g key={d.label}>
              {bh > 0 && (
                <path
                  d={`M${x0},${y0 + bh}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + barW - rr}Q${x0 + barW},${y0} ${x0 + barW},${y0 + rr}V${y0 + bh}Z`}
                  fill="var(--brand)"
                />
              )}
              {i % every === 0 && <text x={cx(i)} y={height - 6} textAnchor="middle" fontSize={FONT} fill="var(--ink-3)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {h && <Tip x={cx(hover!)} y={PAD.top + plotH / 2} w={w} title={h.label}>{h.value.toLocaleString("en-IN")} {unit}</Tip>}
    </Frame>
  );
}
