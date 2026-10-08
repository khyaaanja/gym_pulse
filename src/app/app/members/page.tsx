import Link from "next/link";
import { requireStaff } from "@/lib/page-auth";
import { localDate, diffDays, today as todayIn, fromDbDate, formatDate } from "@/lib/time";
import type { Prisma } from "@/generated/prisma/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { RiskBadge, EstimateBadge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { FormDialog } from "@/components/ui/form-dialog";
import { formatMoney } from "@/lib/money";
import { memberScope } from "@/lib/scope";

export const metadata = { title: "Members" };
const PAGE = 25;

export default async function Members({ searchParams }: PageProps<"/app/members">) {
  const ctx = await requireStaff("members.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const status = ["ACTIVE", "ATTENTION", "AT_RISK", "LOST"].includes(String(sp.status)) ? (String(sp.status) as "ACTIVE") : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.MemberWhereInput = { archivedAt: null, ...(status ? { riskStatus: status } : {}), ...memberScope(ctx) };
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [{ fullName: { contains: q, mode: "insensitive" } }, { memberCode: { contains: q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
  }
  const today = todayIn(ctx.gym.timezone);
  const [items, total, plans, trainers] = await Promise.all([
    ctx.db.member.findMany({ where, orderBy: { fullName: "asc" }, skip: (page - 1) * PAGE, take: PAGE, include: { memberships: { where: { status: { in: ["ACTIVE", "EXPIRED"] } }, orderBy: { endDate: "desc" }, take: 1, include: { plan: true } } } }),
    ctx.db.member.count({ where }),
    ctx.db.membershipPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.db.staffMember.findMany({ where: { role: "TRAINER", active: true }, include: { user: { select: { name: true } } } }),
  ]);
  const qs = (p: number) => `/app/members?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Members" description={`${total} ${status ? status.replace("_", " ").toLowerCase() : ""} members`} actions={ctx.can("members.edit") || ctx.can("members.invite") ? (
        <>{ctx.can("members.edit") && (
          <FormDialog trigger={<Button>Add member</Button>} title="Add member" endpoint="/api/gym/members" successMessage="Member added" fields={[
            { name: "fullName", label: "Full name", required: true },
            { name: "phone", label: "Mobile", type: "tel", placeholder: "98XXXXXXXX" },
            { name: "email", label: "Email", type: "email" },
            { name: "memberCode", label: "Member ID", hint: "Leave empty to assign the next number." },
            { name: "planId", label: "Membership plan", type: "select", options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatMoney(p.pricePaisa, ctx.gym.currencySymbol)}` })), hint: "Payment can be recorded from Renew." },
            { name: "startDate", label: "Start date", type: "text", placeholder: today, defaultValue: today },
            { name: "trainerId", label: "Trainer", type: "select", options: trainers.map((t) => ({ value: t.id, label: t.user.name })) },
          ]} />
        )}
          {ctx.can("members.invite") && (
            <FormDialog trigger={<Button>Invite member</Button>} title="Invite member" endpoint="/api/gym/members/[id]/invite" successMessage="Invite sent" fields={[]} />
          )}</>
      ) : undefined} />
      <form className="mb-4 flex flex-wrap gap-2" action="/app/members">
        <Input name="q" defaultValue={q} placeholder="Search name, phone or member ID" className="max-w-sm" aria-label="Search members" />
        {status && <input type="hidden" name="status" value={status} />}
        <Button type="submit" variant="secondary">Search</Button>
        <div className="flex flex-wrap gap-1">
          {[undefined, "ACTIVE", "ATTENTION", "AT_RISK", "LOST"].map((s) => (
            <Link key={s ?? "all"} href={`/app/members?${new URLSearchParams({ ...(q ? { q } : {}), ...(s ? { status: s } : {}) })}`} className={`rounded-full px-3 py-2 text-sm ${status === s ? "bg-ink text-mist" : "text-ink-2 hover:bg-surface-2"}`}>{s ? s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "All"}</Link>
          ))}
        </div>
      </form>
      <Card><CardBody>
        {items.length === 0 ? <EmptyState title="No members found" body={q ? "Try a different search." : "Add a member, or import your existing records from Analyze Records."} /> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Status</Th><Th>Plan</Th><Th>Expires</Th><Th>Last visit</Th><Th className="text-right">Streak</Th></tr></thead>
            <tbody>
              {items.map((m) => {
                const ms = m.memberships[0];
                const last = m.lastAttendanceAt ? diffDays(localDate(m.lastAttendanceAt, ctx.gym.timezone), today) : null;
                return (
                  <tr key={m.id}>
                    <Td><Link href={`/app/members/${m.id}`} className="font-medium hover:underline">{m.fullName}</Link><span className="block text-xs text-ink-3">{m.memberCode}{m.phone ? ` · ${m.phone}` : ""}</span></Td>
                    <Td><div className="flex flex-wrap gap-1"><RiskBadge status={m.riskStatus} /><EstimateBadge category={m.riskCategory === "LOW" ? null : m.riskCategory} /></div></Td>
                    <Td className="text-ink-2">{ms?.plan.name ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{ms ? formatDate(fromDbDate(ms.endDate), { day: "numeric", month: "short", year: "2-digit" }) : "—"}</Td>
                    <Td className="whitespace-nowrap">{last === null ? "Never" : last === 0 ? "Today" : `${last}d ago`}</Td>
                    <Td className="num text-right">{m.currentStreak}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardBody></Card>
      {total > PAGE && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          <span className="text-ink-3">Page {page} of {Math.ceil(total / PAGE)}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line" href={qs(page - 1)}>Previous</Link>}
            {page * PAGE < total && <Link className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line" href={qs(page + 1)}>Next</Link>}
          </div>
        </nav>
      )}
    </>
  );
}
