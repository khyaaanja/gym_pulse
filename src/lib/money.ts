/** All money is integer paisa. 1 NPR = 100 paisa. */
export const toPaisa = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paisa: number) => paisa / 100;

// Built on first use, not at import: constructing them loads locale data, which held a phone's main thread for tens
// of milliseconds on every page that merely imports this module.
let grouping: Intl.NumberFormat | undefined;
let groupingExact: Intl.NumberFormat | undefined;
const formatter = (exact: boolean) =>
  exact
    ? (groupingExact ??= new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }))
    : (grouping ??= new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }));

/** Nepali rupee, as gyms in Nepal write it. Gyms can pick ₹, रु or NPR in Settings. */
export const DEFAULT_CURRENCY_SYMBOL = "Rs.";

/** "Rs. 1,500" / "NPR 1,500" / "रु 1,500" take a space; a single sign like "₹1,500" doesn't. */
const withSymbol = (symbol: string, amount: string) => (/^\p{Sc}$/u.test(symbol) ? `${symbol}${amount}` : `${symbol} ${amount}`);

export function formatMoney(paisa: number | null | undefined, symbol = DEFAULT_CURRENCY_SYMBOL, exact = false): string {
  if (paisa === null || paisa === undefined) return "—";
  const sign = paisa < 0 ? "-" : "";
  const rupees = Math.abs(paisa) / 100;
  return `${sign}${withSymbol(symbol, formatter(exact).format(rupees))}`;
}

/** Compact form for large dashboard figures: Rs. 1.2L, Rs. 3.4Cr (Nepali/Indian numbering). */
export function formatMoneyCompact(paisa: number, symbol = DEFAULT_CURRENCY_SYMBOL): string {
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 1e7) return withSymbol(symbol, `${(rupees / 1e7).toFixed(1)}Cr`);
  if (Math.abs(rupees) >= 1e5) return withSymbol(symbol, `${(rupees / 1e5).toFixed(1)}L`);
  return formatMoney(paisa, symbol);
}

/** Normalise any plan price to a 30-day monthly equivalent. */
export function monthlyEquivalent(pricePaisa: number, durationDays: number): number {
  if (durationDays <= 0) return 0;
  return Math.round((pricePaisa * 30) / durationDays);
}

/** Apply basis points (10000 = 100%) with integer rounding. */
export const applyBps = (paisa: number, bps: number) => Math.round((paisa * bps) / 10_000);
