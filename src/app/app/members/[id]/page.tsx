import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/page-auth";
import { formatDate, fromDbDate, diffDays, localDate, today as todayIn, addDays } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { RiskBadge, EstimateBadge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { MemberActions } from "@/components/app/member-actions";
import { InviteButton } from "@/components/app/invite-button";
import { canSeeMember } from "@/lib/scope";

const EVENT: Record<string, string> = { CREATED: "Follow-up opened", MESSAGE_SENT: "Message sent", MESSAGE_NOT_SENT: "Message not sent", CALLED: "Called", WHATSAPP_OPENED: "WhatsApp", MARKED_CONTACTED: "Contacted", FOLLOW_UP_SET: "Follow-up scheduled", MEMBER_RETURNED: "Came back", RENEWED: "Renewed", MARKED_LOST: "Marked lost", NOTE: "Note", REOPENED: "Reopened" };

export default async function MemberPage({ params }: PageProps<"/app/members/[id]">) {
  const ctx = await requireStaff("members.view");
  const { id } = await params;
  const m = await ctx.db.member.findUnique({ where: { id }, include: { trainer: { include: { user: { select: { name: true } } } } } });
  if (!m || !canSeeMember(ctx, m)) notFound();
  const today = todayIn(ctx.gym.timezone);
  const [memberships, visits, task, closedTasks, assessment, history, trainers] = await Promise.all([
    ctx.db.membership.findMany({ where: { memberId: m.id }, include: { plan: true }, orderBy: { endDate: "desc" }, take: 8 }),
    ctx.db.attendance.findMany({ where: { memberId: m.id, localDate: { gte: new Date(`${addDays(today, -89)}T00:00:00Z`) } }, select: { localDate: true } }),
    ctx.db.recoveryTask.findFirst({ where: { memberId: m.id, closedAt: null }, include: { events: { orderBy: { createdAt: "asc" } } } }),
    ctx.db.recoveryTask.findMany({ where: { memberId: m.id, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 5 }),
    ctx.db.riskAssessment.findFirst({ where: { memberId: m.id }, orderBy: { assessedAt: "desc" } }),
    ctx.db.riskHistory.findMany({ where: { memberId: m.id }, orderBy: { changedAt: "desc" }, take: 8 }),
    ctx.db.staffMember.findMany({ where: { role: "TRAINER", active: true }, include: { user: { select: { name: true } } } }),
  ]);
  const visited = new Set(visits.map((v) => fromDbDate(v.localDate)));
  const last = m.lastAttendanceAt ? diffDays(localDate(m.lastAttendanceAt, ctx.gym.timezone), today) : null;
  const factors = (assessment?.factors ?? []) as { key: string; label: string; detail: string; contribution: number }[];
  const sym = ctx.gym.currencySymbol;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-start gap-5">
          <Avatar name={m.fullName} className="size-16 text-lg" tone={m.riskStatus === "AT_RISK" ? "risk" : m.riskStatus === "ATTENTION" ? "warn" : undefined} />
          <div className="min-w-0 flex-1">
            <h1 className="display text-3xl font-semibold">{m.fullName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RiskBadge status={m.riskStatus} />
              <EstimateBadge category={m.riskCategory} />
              {m.status !== "ACTIVE" && <StatusPill status={m.status} />}
              {m.userId ? <span className="text-xs text-ink-3">Uses the app</span> : null}
            </div>
            <p className="mt-2 text-sm text-ink-3">{m.memberCode} · {m.phone ?? "no phone"}{m.email ? ` · ${m.email}` : ""} · joined {formatDate(fromDbDate(m.joinedOn))}{m.trainer ? ` · trainer ${m.trainer.user.name}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ctx.can("members.edit") && !m.userId && (m.phone || m.email) && <InviteButton memberId={m.id} />}
            {ctx.can("members.edit") && (
              <FormDialog trigger={<Button variant="secondary">Edit</Button>} title="Edit member" endpoint={`/api/gym/members/${m.id}`} method="PATCH" fields={[
                { name: "fullName", label: "Full name", required: true, defaultValue: m.fullName },
                { name: "phone", label: "Mobile", type: "tel", defaultValue: m.phone },
                { name: "email", label: "Email", type: "email", defaultValue: m.email },
                { name: "trainerId", label: "Trainer", type: "select", defaultValue: m.trainerId, options: trainers.map((t) => ({ value: t.id, label: t.user.name })) },
                { name: "credentialUid", label: "NFC card / wristband ID", defaultValue: m.credentialUid },
                { name: "status", label: "Status", type: "select", required: true, defaultValue: m.status === "ARCHIVED" ? "ACTIVE" : m.status, options: [{ value: "ACTIVE", label: "Active" }, { value: "FROZEN", label: "Frozen" }, { value: "SUSPENDED", label: "Suspended" }] },
                { name: "notes", label: "Notes", type: "textarea", defaultValue: m.notes },
              ]} />
            )}
          </div>
        </CardBody>
        <div className="grid grid-cols-2 border-t border-line text-center sm:grid-cols-4">
          <div className="p-4"><p className="num text-xl font-semibold">{last === null ? "—" : last === 0 ? "Today" : `${last}d`}</p><p className="text-xs text-ink-3">Since last visit</p></div>
          <div className="border-l border-line p-4"><p className="num text-xl font-semibold">{m.currentStreak}</p><p className="text-xs text-ink-3">Current streak</p></div>
          <div className="border-l border-line p-4"><p className="num text-xl font-semibold">{visits.length}</p><p className="text-xs text-ink-3">Visits, 90 days</p></div>
          <div className="border-l border-line p-4"><p className="num text-xl font-semibold">{m.totalVisits}</p><p className="text-xs text-ink-3">All-time visits</p></div>
        </div>
      </Card>

      <div className="grid-cols-1 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {ctx.can("prediction.view") && assessment && (
            <Card>
              <CardHeader title="Why this estimate?" description={`Estimated churn risk: ${assessment.category.toLowerCase()} · score ${assessment.score}/100 · ${assessment.modelVersion}`} />
              <CardBody>
                <ul className="space-y-2.5">
                  {factors.map((f) => (
                    <li key={f.key} className="flex items-start gap-3">
                      <span className="num mt-0.5 w-10 shrink-0 text-right text-sm text-ink-3">{f.contribution > 0 ? `+${Math.round(f.contribution)}` : "·"}</span>
                      <span><span className="block text-[15px]">{f.detail}</span><span className="text-xs text-ink-3">{f.label}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 rounded-xl bg-mist p-3 text-sm"><span className="font-medium">Recommended:</span> {assessment.recommendedAction}</p>
                <p className="mt-3 text-xs text-ink-3">Based only on attendance and membership records from {assessment.dataPeriodStart ? formatDate(assessment.dataPeriodStart) : "the data available"} to {assessment.dataPeriodEnd ? formatDate(assessment.dataPeriodEnd) : "today"}. It&apos;s an estimate, not a prediction that this member will leave, and it says nothing about their reasons.</p>
              </CardBody>
            </Card>
          )}

          {ctx.can("recovery.manage") && (
            <Card>
              <CardHeader title="Recovery" description={task ? `Open since ${formatDate(task.createdAt, undefined, ctx.gym.timezone)} · ${task.reason}` : "No open follow-up."} />
              <CardBody>
                <MemberActions memberId={m.id} fullName={m.fullName} phone={m.phone} gymName={ctx.gym.name} staffName={ctx.user.name} taskId={task?.id ?? null} canMessage={ctx.can("notifications.send")} />
                {task && (
                  <ol className="mt-5 space-y-3 border-l-2 border-line pl-4">
                    {task.events.map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand ring-4 ring-surface" aria-hidden />
                        <p className="text-sm font-medium">{EVENT[e.type] ?? e.type}{e.channel ? ` · ${e.channel.toLowerCase().replace("_", " ")}` : ""}</p>
                        {e.note && <p className="text-sm text-ink-2">{e.note}</p>}
                        <p className="text-xs text-ink-3">{e.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.gym.timezone })}</p>
                      </li>
                    ))}
                  </ol>
                )}
                {closedTasks.length > 0 && (
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-sm font-medium">Earlier follow-ups</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {closedTasks.map((t) => <li key={t.id} className="flex justify-between gap-3"><span><StatusPill status={t.status} /> <span className="ml-1 text-ink-3">{formatDate(t.closedAt, undefined, ctx.gym.timezone)}</span></span>{t.protectedRevenuePaisa ? <span className="num text-ok">{formatMoney(t.protectedRevenuePaisa, sym)} est. protected</span> : null}</li>)}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Last 90 days" />
            <CardBody>
              <div className="grid grid-cols-[repeat(15,1fr)] gap-1" role="img" aria-label={`${visits.length} visits in the last 90 days`}>
                {Array.from({ length: 90 }, (_, i) => addDays(today, i - 89)).map((d) => <span key={d} title={d} className={`aspect-square rounded-[3px] ${visited.has(d) ? "bg-brand" : "bg-surface-2"}`} />)}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Memberships" action={ctx.can("payments.manage") ? <Button asChild size="sm" variant="secondary"><Link href="/app/renew">Record payment</Link></Button> : undefined} />
            <CardBody>
              <ul className="divide-y divide-line text-sm">
                {memberships.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 py-2.5"><span>{x.plan.name}<span className="block text-xs text-ink-3">{formatDate(fromDbDate(x.startDate))} – {formatDate(fromDbDate(x.endDate))}{x.source === "IMPORT" ? " · imported" : ""}</span></span><span className="text-right"><StatusPill status={x.status} /><span className="num block text-xs text-ink-3">{formatMoney(x.pricePaisa, sym)}</span></span></li>)}
                {memberships.length === 0 && <li className="py-2 text-ink-3">No memberships.</li>}
              </ul>
            </CardBody>
          </Card>
          {history.length > 0 && (
            <Card>
              <CardHeader title="Status history" />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {history.map((h) => <li key={h.id} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5">{h.fromStatus && <RiskBadge status={h.fromStatus} />}<span className="text-ink-3">→</span><RiskBadge status={h.toStatus} /></span><span className="text-xs text-ink-3">{formatDate(h.changedAt, { day: "numeric", month: "short" }, ctx.gym.timezone)}</span></li>)}
                </ul>
              </CardBody>
            </Card>
          )}
          {ctx.can("members.delete") && (
            <ActionButton variant="ghost" className="w-full text-risk" method="DELETE" endpoint={`/api/gym/members/${m.id}`} confirm={`Archive ${m.fullName}? They'll leave active lists; their history is kept.`} success="Member archived" redirectTo="/app/members">Archive member</ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
