import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, CalendarX2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { pulseList } from "@/services/pulse";
import { riskAsOf } from "@/services/risk/run";
import { revenueAtRisk } from "@/services/analytics";
import { addDays, fromDbDate, today as todayIn, toDbDate, formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Avatar, EmptyState, PageHeader } from "@/components/ui/misc";
import { EstimateBadge, StatusPill } from "@/components/ui/badge";
import { PulseTrace, TrendBars } from "@/components/ui/pulse-trace";
import { MemberActions } from "@/components/app/member-actions";
import { predictionConfigFor } from "@/config/prediction";

export const metadata = { title: "Pulse" };

const FILTERS = [
  { key: "AT_RISK", label: "At Risk" },
  { key: "ATTENTION", label: "Attention" },
  { key: "LOST", label: "Lost" },
] as const;

export default async function PulsePage({ searchParams }: PageProps<"/app/pulse">) {
  const ctx = await requireStaff("members.view");
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.status)?.key ?? "AT_RISK") as "AT_RISK" | "ATTENTION" | "LOST";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  // A gym with only uploaded registers is measured as of the last day in them (see riskAsOf).
  const trainerId = ctx.staff.role === "TRAINER" ? ctx.staff.id : undefined;
  const scope = { archivedAt: null, ...(trainerId ? { trainerId } : {}) };
  // Independent reads go out together; only the ones that need the as-of date wait for it.
  const [{ asOf: today, anchored }, cfg, counts] = await Promise.all([
    riskAsOf(ctx.gym.id, todayIn(ctx.gym.timezone)),
    predictionConfigFor(ctx.gym.id),
    ctx.db.member.groupBy({ by: ["riskStatus"], where: scope, _count: true }),
  ]);

  const [risk, list, days] = await Promise.all([
    revenueAtRisk(ctx.gym.id, today),
    pulseList(ctx.gym, { filter, page, pageSize: 20, trainerId, asOf: today }),
    // Daily visits by the members currently at risk — the fade that put them here. Same scope as the list: a
    // trainer sees their own members' fade, not the whole gym's.
    ctx.db.attendance.groupBy({ by: ["localDate"], where: { member: { riskStatus: "AT_RISK", ...scope }, localDate: { gte: toDbDate(addDays(today, -44)) } }, _count: true }),
  ]);
  if (page > 1 && list.items.length === 0) redirect(`/app/pulse?status=${filter}`);
  const byDay = new Map(days.map((d) => [fromDbDate(d.localDate), d._count]));
  const series = Array.from({ length: 45 }, (_, i) => byDay.get(addDays(today, i - 44)) ?? 0);
  const count = (k: string) => counts.find((c) => c.riskStatus === k)?._count ?? 0;
  const sym = ctx.gym.currencySymbol;

  return (
    <>
      <PageHeader title="Pulse" description={`Members who may need a call today. Anyone with an active membership and no visit for ${cfg.inactivityThresholdDays}+ days is flagged at risk.`} />
      {anchored && (
        <p className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-ink-2" role="status">
          Showing members as of <span className="font-semibold text-ink">{formatDate(today)}</span>, the last day in your uploaded records. Days are counted to that date because we can&apos;t see visits after it. Once you start checking members in with GymPulse, this switches to today.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="grid-cols-1 grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-end">
          <div>
            <p className="text-[15px] font-medium text-ink-2">Revenue at risk</p>
            <p className="display num mt-1 text-[56px] font-semibold leading-none text-risk sm:text-[72px]">{formatMoney(risk.paisa, sym)}</p>
            <p className="mt-3 text-sm text-ink-3">
              Monthly fees of {risk.members} at-risk member{risk.members === 1 ? "" : "s"} with an active membership. Recorded fact, not a forecast.
            </p>
          </div>
          <div>
            <PulseTrace values={series} className="h-20 w-full" tone="var(--risk)" label="Daily visits by today's at-risk members over the last 45 days" />
            <p className="mt-1 text-right text-xs text-ink-3">Their visits, last 45 days</p>
          </div>
        </div>
      </Card>

      <div className="relative mt-8 flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Filter members">
        {FILTERS.map((f) => (
          <Link key={f.key} role="tab" aria-selected={filter === f.key} href={`/app/pulse?status=${f.key}`} className={`flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 ${filter === f.key ? "bg-ink text-mist ring-ink" : "bg-surface text-ink-2 ring-line"}`}>
            {f.label} <span className={`num ${filter === f.key ? "text-mist/75" : "text-ink-3"}`}>{count(f.key)}</span>
          </Link>
        ))}
      </div>

      <section className="mt-5 space-y-3" aria-label="Members needing attention">
        {list.items.length === 0 ? (
          <Card>
            {filter === "AT_RISK" ? (
              <EmptyState icon={<span>🎉</span>} title="No members at risk" body={`Your members are showing up. We'll alert you automatically when someone reaches ${cfg.inactivityThresholdDays} days without a visit.`} />
            ) : (
              <EmptyState title={`No members in ${FILTERS.find((f) => f.key === filter)!.label}`} body="Nothing to do here right now." />
            )}
          </Card>
        ) : (
          list.items.map((m) => {
            const Trend = m.trend === "down" ? TrendingDown : m.trend === "up" ? TrendingUp : Minus;
            return (
              <Card key={m.id} className="p-4 sm:p-5">
                <div className="grid-cols-1 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <Avatar name={m.fullName} tone={m.riskStatus === "AT_RISK" ? "risk" : m.riskStatus === "ATTENTION" ? "warn" : "lost"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/app/members/${m.id}`} className="display truncate text-lg font-semibold hover:underline">{m.fullName}</Link>
                        <EstimateBadge category={m.riskCategory} />
                        {m.task && <StatusPill status={m.task.status} />}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-3">{m.plan ?? "No plan"} · {m.memberCode}{m.topReason ? <span className="text-ink-2"> · {m.topReason}</span> : null}</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-mist px-4 py-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-ink-3">Last visit</dt>
                      <dd className="mt-0.5 flex items-center gap-1.5 font-medium"><Clock3 className="size-3.5 text-ink-3" aria-hidden />{m.daysInactive === null ? "Never" : `${m.daysInactive}d ago`}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-3">Visits, 30d</dt>
                      <dd className="mt-0.5 flex items-center gap-1.5 font-medium"><TrendBars prev={m.visitsPrev30} last={m.visitsLast30} /><Trend className={`size-3.5 ${m.trend === "down" ? "text-risk" : "text-ink-3"}`} aria-hidden /><span className="num">{m.visitsLast30}</span></dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-3">Expiry</dt>
                      <dd className="mt-0.5 flex items-center gap-1.5 font-medium"><CalendarX2 className="size-3.5 text-ink-3" aria-hidden />{m.expiry ? (m.daysToExpiry! < 0 ? `${-m.daysToExpiry!}d ago` : m.daysToExpiry === 0 ? "Today" : `in ${m.daysToExpiry}d`) : "—"}{m.expiry && <span className="sr-only">{formatDate(m.expiry)}</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-3">At risk / mo</dt>
                      <dd className="num mt-0.5 font-semibold text-risk">{m.monthlyFeePaisa ? formatMoney(m.monthlyFeePaisa, sym) : "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div className="mt-3 pt-3 sm:border-t sm:border-line">
                  <MemberActions memberId={m.id} fullName={m.fullName} phone={m.phone} gymName={ctx.gym.name} staffName={ctx.user.name} taskId={m.task?.id ?? null} canMessage={ctx.can("notifications.send")} />
                </div>
              </Card>
            );
          })
        )}
      </section>

      {list.total > 20 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
          <span className="text-ink-3">Page {page} of {Math.ceil(list.total / 20)}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line" href={`/app/pulse?status=${filter}&page=${page - 1}`}>Previous</Link>}
            {page * 20 < list.total && <Link className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line" href={`/app/pulse?status=${filter}&page=${page + 1}`}>Next</Link>}
          </div>
        </nav>
      )}
      <p className="mt-6 text-xs text-ink-3">&quot;Est.&quot; labels are estimated churn risk from attendance and membership patterns — not a prediction that anyone will leave.</p>
    </>
  );
}
