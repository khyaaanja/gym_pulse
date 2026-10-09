import Link from "next/link";
import type { GymContext } from "@/lib/api";
import { gymSettings } from "@/config/gym-settings";
import { diffDays, formatDate, fromDbDate, today as todayIn } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { memberScope } from "@/lib/scope";
import { dueForRenewal } from "@/services/memberships";

/** The desk works the list top-down (soonest first); past this, the header says how many more are due. */
const RENEW_LIST_LIMIT = 200;

export async function StaffRenew({ ctx, status }: { ctx: GymContext; status: string }) {
  const today = todayIn(ctx.gym.timezone);
  const grace = gymSettings(ctx.gym.settings).renewal.gracePeriodDays;
  const sym = ctx.gym.currencySymbol;
  const [{ rows: due, total: dueTotal }, plans, payments] = await Promise.all([
    dueForRenewal(ctx.db, { today, graceDays: grace, memberWhere: memberScope(ctx), take: RENEW_LIST_LIMIT }),
    ctx.db.membershipPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.can("payments.view") ? ctx.db.payment.findMany({ where: status === "ALL" ? {} : { status: status as "FAILED" }, include: { member: { select: { id: true, fullName: true } }, invoice: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: 40 }) : Promise.resolve([]),
  ]);
  const planOptions = plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatMoney(p.pricePaisa, sym)}` }));

  return (
    <>
      <PageHeader title="Renew" description={`Memberships ending in the next 14 days, plus anyone still inside the ${grace}-day grace period. Reminders go out automatically before expiry.`} />
      <Card>
        <CardHeader title="Due for renewal" description={dueTotal > due.length ? `Showing the ${due.length} ending soonest of ${dueTotal} members` : `${dueTotal} members`} />
        <CardBody>
          {due.length === 0 ? <p className="text-sm text-ink-3">No renewals due in the next two weeks.</p> : (
            <Table>
              <thead><tr><Th>Member</Th><Th>Plan</Th><Th>Ends</Th><Th className="text-right">Fee</Th><Th /></tr></thead>
              <tbody>
                {due.map((m) => {
                  const d = diffDays(today, fromDbDate(m.endDate));
                  return (
                    <tr key={m.id}>
                      <Td><Link href={`/app/members/${m.member.id}`} className="font-medium hover:underline">{m.member.fullName}</Link></Td>
                      <Td className="text-ink-2">{m.plan.name}</Td>
                      <Td className={d < 0 ? "text-risk" : d <= 3 ? "text-warn" : ""}>{formatDate(fromDbDate(m.endDate), { day: "numeric", month: "short" })} · {d < 0 ? `${-d}d ago` : d === 0 ? "today" : `in ${d}d`}</Td>
                      <Td className="num text-right">{formatMoney(m.pricePaisa, sym)}</Td>
                      <Td className="text-right">
                        {ctx.can("payments.manage") && (
                          <FormDialog
                            trigger={<Button size="sm" variant="secondary">Record payment</Button>}
                            title={`Payment from ${m.member.fullName}`}
                            description="For cash, bank transfer or card-machine payments taken at the desk. The membership is extended straight away and a receipt is issued."
                            endpoint="/api/gym/payments/manual"
                            idempotent
                            submitLabel="Record payment"
                            successMessage="Payment recorded and membership renewed"
                            transform="gym.manualPayment" transformArgs={{ memberId: m.member.id }}
                            fields={[
                              { name: "planId", label: "Plan", type: "select", options: planOptions, required: true, defaultValue: m.planId },
                              { name: "method", label: "Method", type: "select", required: true, options: [{ value: "CASH", label: "Cash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "CARD_POS", label: "Card machine" }] },
                              { name: "amountRupees", label: "Amount received (NPR)", type: "number", hint: "Leave empty for the full plan price." },
                              { name: "note", label: "Note", type: "text" },
                            ]}
                          />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {ctx.can("payments.view") && (
        <Card className="mt-6">
          <CardHeader title="Payments" action={
            <div className="flex gap-1 text-sm">
              {["ALL", "FAILED", "PENDING"].map((s) => <Link key={s} href={`/app/renew?status=${s}`} className={`rounded-lg px-2.5 py-1 ${status === s ? "bg-ink text-mist" : "text-ink-2"}`}>{s === "ALL" ? "All" : s === "FAILED" ? "Failed" : "Pending"}</Link>)}
            </div>
          } />
          <CardBody>
            <Table>
              <thead><tr><Th>Date</Th><Th>Member</Th><Th>For</Th><Th>Method</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt, { day: "numeric", month: "short" }, ctx.gym.timezone)}</Td>
                    <Td>{p.member ? <Link href={`/app/members/${p.member.id}`} className="hover:underline">{p.member.fullName}</Link> : "—"}</Td>
                    <Td className="text-ink-2">{p.purpose === "MEMBERSHIP" ? "Membership" : "Order"}</Td>
                    <Td className="text-ink-2">{p.provider ? { esewa: "eSewa", khalti: "Khalti", sandbox: "Test" }[p.provider] ?? p.provider : p.method.replace("_", " ").toLowerCase()}</Td>
                    <Td><StatusPill status={p.status} />{p.failureReason && <span className="ml-2 text-xs text-ink-3">{p.failureReason}</span>}</Td>
                    <Td className="num text-right">{formatMoney(p.amountPaisa, sym)}</Td>
                    <Td className="text-right">{p.invoice && <Link className="text-brand" href={`/app/receipts/${p.id}`}>Receipt</Link>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
