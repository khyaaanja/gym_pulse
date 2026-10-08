import { Flame } from "lucide-react";
import { addDays, diffDays, weekday, type DateOnly } from "@/lib/time";
import { Card } from "@/components/ui/card";

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const dayName = (d: DateOnly) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

type Props = {
  today: DateOnly;
  calendar: DateOnly[];
  currentStreak: number;
  bestStreak: number;
  /** Largest gap between visits that keeps the streak (the gym's rest days + 1). */
  maxGap: number;
  nextMilestone: { tier: string; remaining: number; threshold: number } | null;
};

function status({ today, calendar, currentStreak, maxGap }: Props): { text: string; urgent: boolean } {
  const last = calendar.at(-1);
  if (!last || currentStreak === 0) return { text: "Check in today to start a new streak.", urgent: false };
  const gap = diffDays(last, today);
  if (gap === 0) return { text: `You're in for today. Your streak is safe until ${dayName(addDays(today, maxGap))}.`, urgent: false };
  if (gap >= maxGap) return { text: `Come in today to keep your ${currentStreak}-day streak.`, urgent: true };
  return { text: `Resting today is fine. Come in by ${dayName(addDays(last, maxGap))} to keep it going.`, urgent: false };
}

export function StreakCard(p: Props) {
  const visited = new Set(p.calendar);
  const days = Array.from({ length: 14 }, (_, i) => addDays(p.today, i - 13));
  const s = status(p);
  const m = p.nextMilestone;

  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className={`grid size-16 shrink-0 place-items-center rounded-[1.4rem] ${p.currentStreak > 0 ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-3"}`}>
            <Flame className="size-8" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="display num text-[40px] font-semibold leading-none">
              {p.currentStreak}
              <span className="ml-2 align-baseline text-lg font-medium text-ink-2">day streak</span>
            </p>
            <p className="mt-1.5 text-sm text-ink-3">Best {p.bestStreak} days</p>
          </div>
        </div>

        <ol className="mt-6 grid grid-cols-14 gap-1 sm:gap-1.5" aria-label="Your visits over the last 14 days">
          {days.map((d, i) => {
            const on = visited.has(d);
            const isToday = d === p.today;
            return (
              <li key={d} className="flex flex-col items-center gap-1.5">
                <span
                  className={`streak-day h-9 w-full rounded-full sm:h-11 ${on ? "bg-flame" : "bg-surface-2"} ${isToday && !on ? "ring-2 ring-inset ring-flame" : ""}`}
                  style={on ? { animationDelay: `${120 + i * 45}ms` } : undefined}
                />
                <span className={`text-[11px] leading-none ${isToday ? "font-semibold text-ink" : "text-ink-3"}`} aria-hidden>{LETTERS[weekday(d)]}</span>
                <span className="sr-only">{dayName(d)} {d}: {on ? "visited" : "no visit"}</span>
              </li>
            );
          })}
        </ol>

        <p className={`mt-5 text-[15px] ${s.urgent ? "font-medium text-warn" : "text-ink-2"}`} role={s.urgent ? "status" : undefined}>{s.text}</p>
      </div>

      {m && (
        <div className="flex items-center gap-3 border-t border-line bg-mist/60 px-5 py-3.5 sm:px-6">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`Progress to ${m.tier}`} aria-valuemin={0} aria-valuemax={m.threshold} aria-valuenow={m.threshold - m.remaining}>
            <div className="h-full rounded-full bg-flame" style={{ width: `${((m.threshold - m.remaining) / m.threshold) * 100}%` }} />
          </div>
          <p className="shrink-0 text-sm text-ink-2">
            <span className="num font-semibold text-ink">{m.remaining}</span> more visit{m.remaining === 1 ? "" : "s"} to {m.tier}
          </p>
        </div>
      )}
    </Card>
  );
}
