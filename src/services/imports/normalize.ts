import NepaliDate from "nepali-date-converter";
import { isValidDateOnly, type DateOnly } from "@/lib/time";
import { normalizeNepalPhone } from "@/lib/phone";

export type DateOrder = "DMY" | "MDY" | "YMD";
export type ParsedDate = { date: DateOnly; ambiguous: boolean; fromBS: boolean };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

// Bikram Sambat month names as commonly romanised on gym registers.
const BS_MONTHS: Record<string, number> = {
  baisakh: 1, baishakh: 1, jestha: 2, jeth: 2, ashadh: 3, asar: 3, asadh: 3, shrawan: 4, saun: 4, sawan: 4,
  bhadra: 5, bhadau: 5, ashwin: 6, asoj: 6, kartik: 7, mangsir: 8, poush: 9, push: 9, magh: 10, falgun: 11, fagun: 11, chaitra: 12, chait: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): DateOnly | null {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isValidDateOnly(s) ? s : null;
}

/** Converts a Bikram Sambat date to AD. Returns null for impossible BS dates (the library itself doesn't reject them). */
export function bsToAd(y: number, m: number, d: number): DateOnly | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 32) return null;
  try {
    const nd = new NepaliDate(y, m - 1, d);
    const ad = nd.getAD();
    const back = NepaliDate.fromAD(new Date(Date.UTC(ad.year, ad.month, ad.date, 6)));
    if (back.getYear() !== y || back.getMonth() !== m - 1 || back.getDate() !== d) return null;
    return ymd(ad.year, ad.month + 1, ad.date);
  } catch {
    return null;
  }
}

/** Excel stores dates as days since 1899-12-30 (1900 date system, including Lotus' leap-year bug). */
export function excelSerialToDate(serial: number): DateOnly | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

function yearFrom(raw: string, refYear: number): number {
  const n = Number(raw);
  if (raw.length === 2) return n + (n > 60 ? 1900 : 2000);
  return n || refYear;
}

/**
 * Parses the date formats found on gym registers and spreadsheets:
 * ISO, D/M/Y and M/D/Y (with the gym's preferred order), month names, Excel serials,
 * and Bikram Sambat years (2070–2099), which are converted to AD.
 */
export function parseDate(value: unknown, order: DateOrder = "DMY", refYear = new Date().getFullYear()): ParsedDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(+value) ? null : { date: value.toISOString().slice(0, 10), ambiguous: false, fromBS: false };
  }
  if (typeof value === "number") {
    const d = excelSerialToDate(value);
    return d ? { date: d, ambiguous: false, fromBS: false } : null;
  }
  let s = String(value).trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = excelSerialToDate(Number(s));
    return d ? { date: d, ambiguous: false, fromBS: false } : null;
  }
  s = s.replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i, "").trim();

  // Year first: 2026-09-10, 2082/05/24 (BS)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y >= 2070) {
      const ad = bsToAd(y, mo, d);
      return ad ? { date: ad, ambiguous: false, fromBS: true } : null;
    }
    const iso = ymd(y, mo, d);
    return iso ? { date: iso, ambiguous: false, fromBS: false } : null;
  }

  // Numeric day/month/year in either order
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = yearFrom(m[3]!, refYear);
    let day: number, month: number;
    let ambiguous = false;
    if (a > 12 && b <= 12) [day, month] = [a, b];
    else if (b > 12 && a <= 12) [day, month] = [b, a];
    else {
      ambiguous = a !== b;
      [day, month] = order === "MDY" ? [b, a] : [a, b];
    }
    if (y >= 2070) {
      const ad = bsToAd(y, month, day);
      return ad ? { date: ad, ambiguous, fromBS: true } : null;
    }
    const iso = ymd(y, month, day);
    return iso ? { date: iso, ambiguous, fromBS: false } : null;
  }

  // Month names: "10 Sep 2026", "Sep 10, 2026", "10-Sep-26", "Sep 10", "5 Bhadra 2082"
  const words = s.toLowerCase().replace(/[,]/g, " ").replace(/[-/.]/g, " ").split(" ").filter(Boolean);
  const monthIdx = words.findIndex((w) => MONTHS[w] || BS_MONTHS[w]);
  if (monthIdx >= 0) {
    const nums = words.filter((w, i) => i !== monthIdx && /^\d{1,4}$/.test(w)).map(Number);
    const isBs = !MONTHS[words[monthIdx]!];
    const month = isBs ? BS_MONTHS[words[monthIdx]!]! : MONTHS[words[monthIdx]!]!;
    const day = nums.find((n) => n >= 1 && n <= 32);
    let year = nums.find((n) => n > 31);
    if (day === undefined) return null;
    if (year !== undefined && year < 100) year += 2000;
    if (isBs || (year ?? 0) >= 2070) {
      const y = year ?? 0;
      const ad = y ? bsToAd(y, month, day) : null;
      return ad ? { date: ad, ambiguous: false, fromBS: true } : null;
    }
    let iso = ymd(year ?? refYear, month, day);
    if (!iso) return null;
    // "Sep 10" with no year: pick the most recent occurrence not far in the future.
    if (year === undefined) {
      const now = new Date();
      if (new Date(iso) > new Date(now.getTime() + 45 * 86_400_000)) iso = ymd(refYear - 1, month, day);
    }
    return iso ? { date: iso, ambiguous: false, fromBS: false } : null;
  }
  return null;
}

export function parsePhone(value: unknown): { phone: string | null; invalid: boolean } {
  if (value === null || value === undefined || String(value).trim() === "") return { phone: null, invalid: false };
  const raw = typeof value === "number" ? String(Math.round(value)) : String(value);
  const phone = normalizeNepalPhone(raw);
  return { phone, invalid: !phone };
}

export function parseEmail(value: unknown): { email: string | null; invalid: boolean } {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return { email: null, invalid: false };
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { email: s, invalid: false } : { email: null, invalid: true };
}

/** "Rs. 1,500", "NPR 1500/-", "₹1500", "रु १५००" → paisa. */
export function parseAmount(value: unknown): { paisa: number | null; invalid: boolean } {
  if (value === null || value === undefined || value === "") return { paisa: null, invalid: false };
  if (typeof value === "number") return value >= 0 && value < 10_000_000 ? { paisa: Math.round(value * 100), invalid: false } : { paisa: null, invalid: true };
  const devanagari = "०१२३४५६७८९";
  let s = String(value).replace(/[०-९]/g, (c) => String(devanagari.indexOf(c)));
  s = s.replace(/(rs\.?|npr|inr|₹|रु\.?|\/-)/gi, "").replace(/,/g, "").trim();
  if (!s) return { paisa: null, invalid: false };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n >= 10_000_000) return { paisa: null, invalid: true };
  return { paisa: Math.round(n * 100), invalid: false };
}

export function parseInteger(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && String(value ?? "").trim() !== "" ? Math.round(n) : null;
}

export function cleanName(value: unknown): string | null {
  const s = String(value ?? "")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ((s.match(/\p{L}/gu) ?? []).length < 2) return null;
  const allSameCase = s === s.toUpperCase() || s === s.toLowerCase();
  return allSameCase ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c: string) => p + c.toUpperCase()) : s;
}

export function nameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^\p{L}]/gu, "");
}

/** Maps free-text plan names to a duration in days. */
export function planDuration(value: unknown): number | null {
  const s = String(value ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/(annual|yearly|year|12\s*m)/.test(s)) return 365;
  if (/(half|6\s*m|six)/.test(s)) return 180;
  if (/(quarter|3\s*m|three)/.test(s)) return 90;
  if (/(2\s*m|two month)/.test(s)) return 60;
  if (/(month|1\s*m|monthly|masik|मासिक)/.test(s)) return 30;
  if (/(week)/.test(s)) return 7;
  const n = s.match(/(\d+)\s*(day|din)/);
  return n ? Number(n[1]) : null;
}

const PRESENT = new Set(["p", "present", "✓", "✔", "√", "1", "y", "yes", "x", "*", "•", "ok", "haj", "हा"]);
const ABSENT = new Set(["a", "absent", "0", "-", "n", "no", "", "l", "leave", "h", "holiday"]);

/** Reads an attendance-register cell. `null` means unreadable (needs review). */
export function attendanceMark(value: unknown): boolean | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (PRESENT.has(s)) return true;
  if (ABSENT.has(s)) return false;
  // A time like "6:30" in a day column means they came.
  if (/^\d{1,2}[:.]\d{2}/.test(s)) return true;
  return null;
}
