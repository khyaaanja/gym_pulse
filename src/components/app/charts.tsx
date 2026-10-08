"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "var(--ink-3)", fontSize: 12, tickLine: false, axisLine: false } as const;

function Tip({ active, payload, label, unit, format }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string; format?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-surface px-3 py-2 text-sm shadow-card ring-1 ring-line">
      <p className="text-xs text-ink-3">{format ? format(String(label)) : label}</p>
      <p className="num font-semibold text-ink">{payload[0]!.value.toLocaleString("en-IN")} {unit}</p>
    </div>
  );
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Single series: daily check-ins. No legend (the title names it); crosshair tooltip on hover. */
export function AttendanceChart({ data, height = 220 }: { data: { date: string; visits: number }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`Daily check-ins, ${data.length} days`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="att" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
          <XAxis dataKey="date" {...axis} tickFormatter={dayLabel} minTickGap={28} />
          <YAxis {...axis} allowDecimals={false} width={36} />
          <Tooltip cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }} content={<Tip unit="check-ins" format={dayLabel} />} />
          <Area type="monotone" dataKey="visits" stroke="var(--brand)" strokeWidth={2} fill="url(#att)" activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-hue bars for magnitude (e.g. revenue by stream). Labels are the categories; values in the tooltip. */
export function MagnitudeBars({ data, unit, height = 220 }: { data: { label: string; value: number }[]; unit: string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={18}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={44} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<Tip unit={unit} />} />
          <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
