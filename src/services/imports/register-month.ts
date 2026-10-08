import { monthKey, type DateOnly } from "@/lib/time";

/** Which month a day-numbered register (columns 1–31) covers, read from its file name, sheet name or headers. */
export function guessRegisterMonth(texts: (string | null | undefined)[], today: DateOnly): { month: string; assumed: boolean } {
  const joined = texts.filter(Boolean).join(" ").toLowerCase();
  const iso = joined.match(/(20\d{2})[-_ ./](0?[1-9]|1[0-2])\b/);
  if (iso) {
    const y = Number(iso[1]);
    const m = String(Number(iso[2])).padStart(2, "0");
    return { month: y >= 2070 ? `BS:${y}-${m}` : `${y}-${m}`, assumed: false };
  }
  const bs = ["baisakh", "jestha", "ashadh", "shrawan", "bhadra", "ashwin", "kartik", "mangsir", "poush", "magh", "falgun", "chaitra"];
  const ad = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const year = joined.match(/\b(20\d{2})\b/)?.[1];
  const bi = bs.findIndex((m) => joined.includes(m));
  if (bi >= 0 && year && Number(year) >= 2070) return { month: `BS:${year}-${String(bi + 1).padStart(2, "0")}`, assumed: false };
  const ai = ad.findIndex((m) => new RegExp(`\\b${m}`).test(joined));
  if (ai >= 0) {
    let y = year ? Number(year) : Number(today.slice(0, 4));
    const candidate = `${y}-${String(ai + 1).padStart(2, "0")}`;
    if (!year && candidate > monthKey(today)) y -= 1;
    return { month: `${y}-${String(ai + 1).padStart(2, "0")}`, assumed: !year };
  }
  return { month: monthKey(today), assumed: true };
}
