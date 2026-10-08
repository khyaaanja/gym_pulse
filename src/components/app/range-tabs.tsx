import Link from "next/link";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export function RangeTabs({ current, base }: { current: string; base: string }) {
  return (
    <div className="inline-flex rounded-2xl bg-surface p-1 ring-1 ring-line" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <Link key={r.key} role="tab" aria-selected={current === r.key} href={`${base}?range=${r.key}`} className={`rounded-xl px-3 py-1.5 text-sm font-medium ${current === r.key ? "bg-ink text-mist" : "text-ink-2 hover:text-ink"}`}>
          {r.label}
        </Link>
      ))}
    </div>
  );
}
