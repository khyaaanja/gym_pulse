import { CheckCircle2, Flame, Medal, Trophy } from "lucide-react";
import type { MemberContext } from "@/lib/api";
import { attendanceSummary } from "@/services/attendance";
import { addDays, formatDate, today as todayIn, weekday } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { MemberPass } from "./member-pass";
import { Medal3D } from "@/components/three/medal";

const TIERS: Record<string, string> = { bronze: "#b0703f", silver: "#8d97ab", gold: "#e7b52c", platinum: "#7f9cf0" };
const tierColor = (tier: string) => TIERS[tier.toLowerCase()] ?? "#e7b52c";

export async function MemberAttendance({ ctx }: { ctx: MemberContext }) {
  const today = todayIn(ctx.gym.timezone);
  const s = await attendanceSummary(ctx.gym, ctx.member.id, today);
  const visited = new Set(s.calendar);
  // 16 weeks, Sunday-first columns
  const end = addDays(today, 6 - weekday(today));
  const start = addDays(end, -16 * 7 + 1);
  // The medal shown: the highest streak tier unlocked, otherwise the next one to aim for.
  const streakTiers = s.milestones.filter((m) => m.kind === "STREAK");
  const top = [...streakTiers].reverse().find((m) => m.achieved) ?? streakTiers.find((m) => !m.achieved) ?? s.milestones[0];
  const medal = top
    ? { tier: top.tier, achieved: top.achieved, caption: top.kind === "STREAK" ? `${top.threshold}-day streak` : `${top.threshold} visits` }
    : { tier: "Bronze", achieved: false, caption: "Start a streak" };
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="display text-3xl font-extrabold">Your progress</h1>
      <Card className="overflow-hidden">
        <div className="bg-dusk relative grid grid-cols-1 items-center gap-2 text-white sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <Medal3D
            className="relative mx-auto h-56 w-full max-w-60 cursor-grab active:cursor-grabbing"
            tier={medal.tier}
            caption={medal.caption}
            color={tierColor(medal.tier)}
            locked={!medal.achieved}
            fallback={<Medal className="size-16" style={{ color: tierColor(medal.tier) }} aria-hidden />}
          />
          <div className="px-6 pb-6 sm:py-6 sm:pl-0">
            <p className="text-sm text-white/70">{medal.achieved ? `Latest medal · ${medal.tier}` : `Next medal · ${medal.tier}`}</p>
            <div className="mt-1 flex items-end gap-3">
              <Flame className="mb-1 size-9 text-[#ffb454]" aria-hidden />
              <p className="display num text-6xl font-extrabold leading-none">{s.currentStreak}</p>
              <p className="mb-1.5 text-white/75">day streak</p>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3">
              <div><dt className="text-xs text-white/65">This week</dt><dd className="display num text-2xl font-bold">{s.weeklyVisits}</dd></div>
              <div><dt className="text-xs text-white/65">This month</dt><dd className="display num text-2xl font-bold">{s.monthlyVisits}</dd></div>
              <div><dt className="text-xs text-white/65">Best streak</dt><dd className="display num text-2xl font-bold">{s.bestStreak}</dd></div>
            </dl>
          </div>
        </div>
        <div className="border-t border-line px-5 py-4">
          {s.checkedInToday ? (
            <p className="flex items-center gap-2 font-medium text-ok"><CheckCircle2 className="size-5" /> You&apos;re checked in today.</p>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-ink-2">Scan the code at reception, or show your pass.</p>
              <div className="w-36"><MemberPass checkedIn={false} /></div>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-3">{s.maxGap <= 1 ? "Your streak counts visits on consecutive days." : s.maxGap === 2 ? "Rest days are fine — your streak continues as long as you don't miss two days in a row." : `You can rest up to ${s.maxGap - 1} days in a row without losing your streak.`}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Last 16 weeks" description={`${s.calendar.length} visits`} />
        <CardBody>
          <div className="grid grid-flow-col grid-rows-7 gap-1" role="img" aria-label={`Attendance calendar: ${s.calendar.length} visits in the last 16 weeks`}>
            {days.map((d) => (
              <span key={d} title={d} className={`aspect-square rounded-[4px] ${d > today ? "bg-transparent" : visited.has(d) ? "bg-flame" : "bg-surface-2"} ${d === today ? "ring-2 ring-ink" : ""}`} />
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Milestones" description={`${s.milestones.filter((m) => m.achieved).length} of ${s.milestones.length} unlocked`} />
        <CardBody className="pt-0">
          <ul className="divide-y divide-line">
            {s.milestones.map((m) => {
              const have = m.kind === "STREAK" ? s.currentStreak : s.totalVisits;
              const unit = m.kind === "STREAK" ? "days" : "visits";
              return (
                <li key={m.id} className="flex items-center gap-4 py-3.5">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${m.achieved ? "" : "bg-surface-2 text-ink-3"}`} style={m.achieved ? { color: tierColor(m.tier), background: `color-mix(in oklab, ${tierColor(m.tier)} 16%, transparent)` } : undefined}>
                    <Medal className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{m.tier}</p>
                      <p className={`num shrink-0 text-sm ${m.achieved ? "font-medium text-ok" : "text-ink-3"}`}>{m.achieved ? "Unlocked" : have >= m.threshold ? "Reached" : `${have} of ${m.threshold} ${unit}`}</p>
                    </div>
                    <p className="truncate text-sm text-ink-3">{m.kind === "STREAK" ? `${m.threshold}-day streak` : `${m.threshold} total visits`}{m.reward ? ` · ${m.reward}` : ""}</p>
                    {!m.achieved && (have >= m.threshold ? <p className="mt-1 text-sm font-medium text-warn">Unlocks at your next check-in.</p> : <Progress className="mt-2 h-1.5" value={have} max={m.threshold} tone="warn" label={`Progress to ${m.tier}`} />)}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Challenges" description="Resets monthly unless it's a streak challenge." />
        <CardBody className="space-y-4">
          {s.challenges.length === 0 && <p className="text-sm text-ink-3">Your gym hasn&apos;t set up any challenges yet.</p>}
          {s.challenges.map((c) => (
            <div key={c.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{c.name}{c.completed && <Trophy role="img" className="ml-2 inline size-4 text-warn" aria-label="Completed" />}</p>
                <p className="num text-sm text-ink-3">{c.progress}/{c.target}</p>
              </div>
              {c.description && <p className="text-sm text-ink-3">{c.description}</p>}
              <Progress className="mt-2" value={c.progress} max={c.target} tone={c.completed ? "ok" : "brand"} label={c.name} />
            </div>
          ))}
        </CardBody>
      </Card>

      {s.rewards.length > 0 && (
        <Card>
          <CardHeader title="Your rewards" />
          <CardBody>
            <ul className="divide-y divide-line">
              {s.rewards.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{r.name}</span>
                  <span className="text-ink-3">{formatDate(new Date(r.awardedAt), { day: "numeric", month: "short" }, ctx.gym.timezone)}{r.redeemedAt ? " · redeemed" : ""}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
