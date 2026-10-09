import { DEFAULT_CURRENCY_SYMBOL, formatMoney } from "@/lib/money";
import { formatDate, msSince, NEPAL_TZ } from "@/lib/time";

export function Money({ paisa, symbol = DEFAULT_CURRENCY_SYMBOL, className }: { paisa: number | null | undefined; symbol?: string; className?: string }) {
  return <span className={`num ${className ?? ""}`}>{formatMoney(paisa, symbol)}</span>;
}

/** `tz`: the gym's time zone for the absolute date (older than 30 days) and the hover title. */
export function RelTime({ date, tz = NEPAL_TZ }: { date: Date | string | null | undefined; tz?: string }) {
  if (!date) return <span className="text-ink-3">—</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = msSince(d);
  const days = Math.floor(diff / 86_400_000);
  const text = diff < 60_000 ? "just now" : diff < 3_600_000 ? `${Math.floor(diff / 60_000)} min ago` : days < 1 ? `${Math.floor(diff / 3_600_000)} h ago` : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : formatDate(d, { day: "numeric", month: "short", year: "numeric" }, tz);
  // Relative text can tick over between server render and hydration ("38 min" → "39 min"); that difference is expected.
  return <time dateTime={d.toISOString()} title={formatDate(d, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, tz)} suppressHydrationWarning>{text}</time>;
}
