import { RISK_STATUS } from "@/components/ui/badge";

/**
 * Part-to-whole of member status. Status colours are reserved for state and always travel
 * with a text label, count and shape (never colour alone). Fills are spaced by lightness and the
 * two dark ones are hatched differently, so segments separate under colour-vision deficiency.
 */
const SEG = [
  { key: "ACTIVE", cls: "bg-ok-fill", text: "text-ok" },
  { key: "ATTENTION", cls: "bg-warn-fill", text: "text-warn" },
  { key: "AT_RISK", cls: "bg-risk-fill hatch-risk", text: "text-risk" },
  { key: "LOST", cls: "bg-lost-fill hatch-lost", text: "text-lost" },
] as const;

export function StatusBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[3px] overflow-hidden rounded-full" role="img" aria-label={SEG.map((s) => `${RISK_STATUS[s.key]!.label} ${counts[s.key] ?? 0}`).join(", ")}>
        {SEG.map((s) => {
          const n = counts[s.key] ?? 0;
          return n ? <div key={s.key} className={`${s.cls} first:rounded-l-full last:rounded-r-full`} style={{ width: `${(n / total) * 100}%` }} title={`${RISK_STATUS[s.key]!.label}: ${n}`} /> : null;
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {SEG.map((s) => {
          const { label, icon: Icon } = RISK_STATUS[s.key]!;
          return (
            <li key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <Icon className={`size-4 shrink-0 ${s.text}`} strokeWidth={2.25} aria-hidden />
              <span className="text-ink-2">{label}</span>
              <span className="num font-semibold">{counts[s.key] ?? 0}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
