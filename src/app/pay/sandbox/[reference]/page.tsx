import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/page-auth";
import { formatMoney } from "@/lib/money";
import { testGatewayEnabled } from "@/services/payments/providers";
import { SandboxDecision } from "./decision";

export const metadata = { title: "Test payment" };

/** The test gateway page (non-production only). No real money moves; confirmation still comes via a signed webhook. */
export default async function SandboxPay({ params }: PageProps<"/pay/sandbox/[reference]">) {
  if (!testGatewayEnabled()) notFound();
  const { reference } = await params;
  const ctx = await requireMember();
  const p = await ctx.db.payment.findFirst({ where: { reference, memberId: ctx.member.id, provider: "sandbox" } });
  if (!p) notFound();
  if (p.status !== "PENDING") redirect(p.status === "SUCCEEDED" ? `/app/receipts/${p.id}` : "/app/renew?payment=failed");
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-lift ring-1 ring-line">
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-medium text-warn">Test mode — no real money is charged.</p>
        <p className="mt-6 text-sm text-ink-3">GymPulse Test Gateway · {ctx.gym.name}</p>
        <p className="display num mt-1 text-4xl font-semibold">{formatMoney(p.amountPaisa, ctx.gym.currencySymbol)}</p>
        <p className="mt-1 text-sm text-ink-3">Reference {p.reference}</p>
        <SandboxDecision reference={p.reference} />
      </div>
    </main>
  );
}
