import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** Date-only values are ISO strings "YYYY-MM-DD"; Prisma @db.Date columns hold them as UTC midnight. */
export type DateOnly = string;

export const NEPAL_TZ = "Asia/Kathmandu";
const DAY_MS = 86_400_000;

export function localDate(instant: Date, tz: string = NEPAL_TZ): DateOnly {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

export function localHour(instant: Date, tz: string = NEPAL_TZ): number {
  return Number(formatInTimeZone(instant, tz, "H"));
}

export function today(tz: string = NEPAL_TZ, now: Date = new Date()): DateOnly {
  return localDate(now, tz);
}

/** The instant a wall-clock time (`HH:mm:ss`) on local calendar day `d` happens in `tz`. */
export function localInstant(d: DateOnly, time: string, tz: string = NEPAL_TZ): Date {
  return fromZonedTime(`${d.slice(0, 10)}T${time}`, tz);
}

/** The instant a local calendar day starts in `tz` (e.g. for filtering timestamp columns from "today"). */
export function startOfLocalDay(d: DateOnly, tz: string = NEPAL_TZ): Date {
  return localInstant(d, "00:00:00", tz);
}

export function toDbDate(d: DateOnly): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date-only value: ${d}`);
  return new Date(`${d}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): DateOnly {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: DateOnly, days: number): DateOnly {
  return fromDbDate(new Date(toDbDate(d).getTime() + days * DAY_MS));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: DateOnly, b: DateOnly): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday (Saturday is the weekly holiday in Nepal). */
export function weekday(d: DateOnly): number {
  return toDbDate(d).getUTCDay();
}

export function monthKey(d: DateOnly): string {
  return d.slice(0, 7);
}

export function startOfMonth(d: DateOnly): DateOnly {
  return `${d.slice(0, 7)}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValidDateOnly(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return fromDbDate(toDbDate(d)) === d;
}

/** Request-time clock helpers (kept out of render bodies for lint purity). */
export const now = () => new Date();
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
export const msSince = (d: Date) => Date.now() - d.getTime();

/** Instants are shown in `tz` (pass the gym's timezone on gym pages); date-only values are calendar days as-is. */
export function formatDate(d: Date | DateOnly | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }, tz: string = NEPAL_TZ) {
  if (!d) return "—";
  const date = typeof d === "string" ? toDbDate(d) : d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: typeof d === "string" ? "UTC" : tz, ...opts }).format(date);
}

export function relativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
