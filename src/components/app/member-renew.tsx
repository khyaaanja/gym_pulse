import Link from "next/link";
import type { MemberContext } from "@/lib/api";
import { availableProviders } from "@/services/payments/service";
import { diffDays, formatDate, fromDbDate, today as todayIn } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { RenewCheckout } from "./renew-checkout";

export async function MemberRenew({ ctx, notice, wantedPlanId, coupon, welcome }: { ctx: MemberContext; notice?: string; wantedPlanId?: string; coupon?: string; welcome?: boolean }) {
  const today = todayIn(ctx.gym.timezone);
  const [ms, plans, payments, providers] = await Promise.all([
    ctx.db.membership.findFirst({ where: { memberId: ctx.member.id, status: { in: ["ACTIVE", "EXPIRED"] } }, orderBy: { endDate: "desc" }, include: { plan: true } }),
    ctx.db.membershipPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] }),
    ctx.db.payment.findMany({ where: { memberId: ctx.member.id }, include: { invoice: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    ctx.flags.payments ? availableProviders(ctx.gym.id) : Promise.resolve([]),
  ]);
  const left = ms ? diffDays(today, fromDbDate(ms.endDate)) : null;
  const names: Record<string, string> = { sandbox: "Test gateway", esewa: "eSewa", khalti: "Khalti" };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {welcome && <p role="status" className="rounded-2xl bg-ok-soft p-4 text-sm font-medium text-ok">Welcome to {ctx.gym.name}! Your account is ready. Pay for your plan below — or pay at the front desk and staff will activate it.</p>}
      {notice === "failed" && <p role="alert" className="rounded-2xl bg-risk-soft p-4 text-sm font-medium text-risk">Payment couldn&apos;t be confirmed. Please try again. If money left your account, it will be matched or refunded by the provider.</p>}
      {notice === "pending" && <p role="status" className="rounded-2xl bg-warn-soft p-4 text-sm font-medium text-warn">Your payment is still being confirmed by the provider. We&apos;ll update your membership as soon as it&apos;s confirmed.</p>}
      <Card>
        <CardBody>
          {ms ? (
            <>
              <p className="text-sm text-ink-3">{ms.plan.name}</p>
              <h1 className={`display mt-1 text-3xl font-semibold ${left !== null && left < 0 ? "text-risk" : ""}`}>
                {left === null ? "" : left < 0 ? `Expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "Membership expires today" : `Membership expires in ${left} day${left === 1 ? "" : "s"}`}
              </h1>
              <p className="mt-1 text-sm text-ink-3">Valid until {formatDate(fromDbDate(ms.endDate))}. Renewing early adds time after this date — you don&apos;t lose any days.</p>
            </>
          ) : (
            <h1 className="display text-2xl font-semibold">Choose your membership</h1>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Renew" />
        <CardBody>
          <RenewCheckout plans={plans.map((p) => ({ id: p.id, name: p.name, description: p.description, durationDays: p.durationDays, pricePaisa: p.pricePaisa }))} providers={providers.map((p) => ({ key: p.key, name: names[p.key] ?? p.displayName }))} currentPlanId={wantedPlanId ?? ms?.planId ?? null} symbol={ctx.gym.currencySymbol} initialCoupon={coupon} firstTime={!ms} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Payment history" />
        <CardBody>
          {payments.length === 0 ? <p className="text-sm text-ink-3">No payments yet.</p> : (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{p.purpose === "MEMBERSHIP" ? "Membership" : "Marketplace order"}</p>
                    <p className="text-ink-3">{formatDate(p.paidAt ?? p.createdAt, { day: "numeric", month: "short", year: "numeric" }, ctx.gym.timezone)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={p.status} />
                    <span className="num font-medium">{formatMoney(p.amountPaisa, ctx.gym.currencySymbol)}</span>
                    {p.invoice && <Link className="text-brand" href={`/app/receipts/${p.id}`}>Receipt</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
