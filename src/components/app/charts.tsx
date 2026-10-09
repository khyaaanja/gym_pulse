"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

/**
 * The app's two charts, drawn as plain SVG. They replaced Recharts, which was ~370 KB of JS whose evaluation alone
 * held a phone's main thread for over a second on the dashboard. These draw in well under a millisecond.
 */

const PAD = { top: 8, right: 8, bottom: 24 } as const;
const FONT = 12;

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

/**
 * The box's width (0 until measured, on the server and before the first layout) and the font its labels are drawn
 * in, re-read once web fonts finish loading so labels are spaced for the font actually on screen.
 */
function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [font, setFont] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setFont(`${FONT}px ${getComputedStyle(el).fontFamily}|${document.fonts?.status ?? ""}`);
    read();
    let live = true;
    void document.fonts?.ready.then(() => { if (live) read(); });
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => { live = false; ro.disconnect(); };
  }, []);
  return [ref, w, font] as const;
}

let ruler: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();
/** Rendered width of a label in `font`, cached: hover and arrow keys re-render the chart, labels rarely change. */
function textWidth(text: string, font: string) {
  const key = `${font}\n${text}`;
  let v = widths.get(key);
  if (v === undefined) {
    ruler ??= document.createElement("canvas").getContext("2d");
    if (ruler) ruler.font = font.split("|")[0]!;
    v = ruler ? ruler.measureText(text).width : text.length * 6.6;
    widths.set(key, v);
  }
  return v;
}

/**
 * Which axis labels to draw, and where: each label is pulled inside the chart's edges, the last one is always kept
 * (the newest day matters most), and the rest go left to right wherever they clear the previous label by `gap` px.
 * Labels that would collide are dropped instead of overlapping. A label that would have to move more than `maxShift`
 * px to fit (a long name under the last of many narrow bars would end up under its neighbour) is dropped instead.
 */
function thin(labels: string[], at: (i: number) => number, w: number, font: string, gap: number, maxShift = Infinity) {
  const place = (i: number) => {
    const half = textWidth(labels[i]!, font) / 2;
    const c = Math.min(w - half, Math.max(half, at(i)));
    return [c - half, c + half, c] as const;
  };
  const show = new Map<number, number>();
  if (labels.length === 0) return show;
  const last = labels.length - 1;
  const [lastL0, , lastC0] = place(last);
  const keepLast = Math.abs(lastC0 - at(last)) <= maxShift;
  const [lastL, lastC] = keepLast ? [lastL0, lastC0] : [w, 0];
  let edge = -Infinity;
  for (let i = 0; i < last; i++) {
    const [l, r, c] = place(i);
    if (l >= edge + gap && r + gap <= lastL && Math.abs(c - at(i)) <= maxShift) {
      show.set(i, c);
      edge = r;
    }
  }
  if (keepLast) show.set(last, lastC);
  return show;
}

/**
 * The highlighted point or bar, by index; null when nothing is highlighted, or when the data has since shrunk past it
 * (switching range keeps the chart mounted). A mouse clears it on leaving the chart, a scroll that began on the chart
 * cancels it, and a finger tap leaves it up until the next tap outside the chart. Arrow keys move it while focused.
 */
function useHover(box: RefObject<HTMLDivElement | null>, count: number) {
  const [raw, setRaw] = useState<number | null>(null);
  // Announce only what the keyboard picked: a mouse sweep would otherwise fire dozens of announcements.
  const [byKey, setByKey] = useState(false);
  const setHover = (i: number | null, key = false) => { setRaw(i); setByKey(key); };
  // Drop (not just hide) a highlight the data has shrunk past, so it can't come back when the data grows again.
  if (raw !== null && raw >= count) setRaw(null);
  const hover = raw !== null && raw < count ? raw : null;
  useEffect(() => {
    if (raw === null) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setRaw(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [raw, box]);
  const step = (e: KeyboardEvent) => {
    // Leave Alt/Cmd/Ctrl+arrow to the browser (history back/forward, text navigation).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = { ArrowRight: (hover ?? -1) + 1, ArrowLeft: (hover ?? count) - 1, Home: 0, End: count - 1 }[e.key];
    if (to !== undefined) { e.preventDefault(); setHover(Math.min(count - 1, Math.max(0, to)), true); }
    else if (e.key === "Escape") setHover(null);
  };
  const events = {
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType !== "touch") setHover(null); },
    onPointerCancel: () => setHover(null),
    onKeyDown: step,
    onBlur: () => setHover(null),
  };
  return [hover, setHover, events, byKey] as const;
}

/** Right of the point when it fits, else left of it, and never past either edge of the chart. */
function Tip({ x, y, w, title, children }: { x: number; y: number; w: number; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(0);
  useLayoutEffect(() => setTw(ref.current?.offsetWidth ?? 0), [title, children]);
  const left = x + 12 + tw <= w ? x + 12 : x - 12 - tw >= 0 ? x - 12 - tw : Math.max(0, w - tw);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl bg-surface px-3 py-2 text-sm shadow-card ring-1 ring-line"
      style={{ left, top: y, transform: "translateY(-50%)", visibility: tw ? "visible" : "hidden" }}
    >
      <p className="text-xs text-ink-3">{title}</p>
      <p className="num font-semibold text-ink">{children}</p>
    </div>
  );
}

type Events = ReturnType<typeof useHover>[2];

/**
 * The chart's box. The drawing is one focusable image (name = the whole series); the highlighted value is also
 * announced through a polite live region, so arrow-key users hear what a mouse user reads in the tooltip.
 */
function Frame({ height, label, box, events, live, children }: { height: number; label: string; box: RefObject<HTMLDivElement | null>; events?: Events; live?: string; children?: ReactNode }) {
  return (
    <div ref={box} className="relative select-none" style={{ height }}>
      <div
        role="img"
        aria-label={label}
        tabIndex={events ? 0 : undefined}
        className="h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand"
        style={{ touchAction: "pan-y pinch-zoom" }}
        {...events}
      >
        {children}
      </div>
      <p className="sr-only" aria-live="polite">{live ?? ""}</p>
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

/** Single series: daily check-ins. No legend (the title names it); crosshair tooltip on hover, touch or arrow keys. */
export function AttendanceChart({ data, height = 220 }: { data: { date: string; visits: number }[]; height?: number }) {
  const [box, w, font] = useBox();
  const [hover, setHover, events, byKey] = useHover(box, data.length);
  // useId's punctuation isn't safe inside url(#…).
  const fill = `att${useId().replace(/[^\w-]/g, "")}`;
  const label = `Daily check-ins, ${data.length} days`;
  if (!w || !font || data.length === 0) return <Frame box={box} height={height} label={label} />;

  const left = 36;
  const ts = ticks(Math.max(0, ...data.map((d) => d.visits)));
  const top = ts.at(-1)!;
  const plotW = w - left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => left + (data.length === 1 ? plotW / 2 : (i * plotW) / (data.length - 1));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.visits)] as [number, number]);
  const line = monotone(pts);
  const area = `${line}L${pts.at(-1)![0]},${y(0)}L${pts[0]![0]},${y(0)}Z`;
  const days = data.map((d) => dayLabel(d.date));
  const shown = thin(days, x, w, font, 20);

  const pick = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - left) / plotW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? data[hover]! : null;
  const value = h ? `${h.visits.toLocaleString("en-IN")} check-ins` : "";

  return (
    <Frame box={box} height={height} label={label} events={events} live={h && byKey ? `${dayLabel(h.date)}: ${value}` : ""}>
      <svg width={w} height={height} className="block overflow-visible" onPointerMove={pick} onPointerDown={pick}>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis ticks={ts} y={y} left={left} w={w} format={String} />
        {data.map((d, i) => (shown.has(i) ? (
          <text key={d.date} x={shown.get(i)} y={height - 6} textAnchor="middle" fontSize={FONT} fill="var(--ink-3)">{days[i]}</text>
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
      {h && <Tip x={x(hover!)} y={pts[hover!]![1]} w={w} title={dayLabel(h.date)}>{value}</Tip>}
    </Frame>
  );
}

/** Single-hue bars for magnitude (e.g. revenue by stream). Labels are the categories; values in the tooltip. */
export function MagnitudeBars({ data, unit, height = 220 }: { data: { label: string; value: number }[]; unit: string; height?: number }) {
  const [box, w, font] = useBox();
  const [hover, setHover, events, byKey] = useHover(box, data.length);
  const label = data.map((d) => `${d.label}: ${d.value}`).join(", ");
  if (!w || !font || data.length === 0) return <Frame box={box} height={height} label={label} />;

  const left = 44;
  const ts = ticks(Math.max(0, ...data.map((d) => d.value)));
  const top = ts.at(-1)!;
  const plotW = w - left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const gap = Math.min(18, band * 0.2);
  const barW = Math.min(48, Math.max(1, band - gap * 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const cx = (i: number) => left + band * i + band / 2;
  const shown = thin(data.map((d) => d.label), cx, w, font, 8, band / 2);

  const pick = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - left) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };
  const h = hover !== null ? data[hover]! : null;
  const value = h ? `${h.value.toLocaleString("en-IN")} ${unit}` : "";
  const r = Math.min(4, barW / 2);

  return (
    <Frame box={box} height={height} label={label} events={events} live={h && byKey ? `${h.label}: ${value}` : ""}>
      <svg width={w} height={height} className="block overflow-visible" onPointerMove={pick} onPointerDown={pick}>
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
              {shown.has(i) && <text x={shown.get(i)} y={height - 6} textAnchor="middle" fontSize={FONT} fill="var(--ink-3)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {h && <Tip x={cx(hover!)} y={PAD.top + plotH / 2} w={w} title={h.label}>{value}</Tip>}
    </Frame>
  );
}
