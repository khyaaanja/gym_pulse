import { notFound } from "next/navigation";
import { appMode } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt" };

export default async function Receipt({ params }: PageProps<"/app/receipts/[id]">) {
  const { id } = await params;
  const mode = await appMode();
  if (mode.kind !== "member" && mode.kind !== "staff") notFound();
  const payment = await mode.ctx.db.payment.findUnique({ where: { id }, include: { invoice: true, member: true } });
  // Members see only their own receipts; staff need payment access.
  if (!payment || !payment.invoice) notFound();
  if (mode.kind === "member" && payment.memberId !== mode.ctx.member.id) notFound();
  if (mode.kind === "staff" && !mode.ctx.can("payments.view")) notFound();
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: payment.gymId } });
  const lines = payment.invoice.lines as { description: string; amountPaisa: number }[];
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardBody className="space-y-6 p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="display text-xl font-semibold">{gym.name}</p>
              <p className="text-sm text-ink-3">{[gym.address, gym.city].filter(Boolean).join(", ")}</p>
            </div>
            <p className="rounded-full bg-ok-soft px-3 py-1 text-sm font-medium text-ok">Paid</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-3">Receipt</dt><dd className="num font-medium">{payment.invoice.number}</dd></div>
            <div><dt className="text-ink-3">Date</dt><dd className="font-medium">{payment.invoice.issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</dd></div>
            <div><dt className="text-ink-3">Member</dt><dd className="font-medium">{payment.member?.fullName}</dd></div>
            <div><dt className="text-ink-3">Paid with</dt><dd className="font-medium">{payment.provider ? { esewa: "eSewa", khalti: "Khalti", sandbox: "Test gateway" }[payment.provider] ?? payment.provider : payment.method.replace("_", " ").toLowerCase()}</dd></div>
          </dl>
          <ul className="divide-y divide-line border-y border-line">
            {lines.map((l, i) => <li key={i} className="flex justify-between gap-4 py-3 text-sm"><span>{l.description}</span><span className="num">{formatMoney(l.amountPaisa, gym.currencySymbol)}</span></li>)}
          </ul>
          <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="num">{formatMoney(payment.invoice.totalPaisa, gym.currencySymbol)}</span></div>
          <p className="text-xs text-ink-3">Reference {payment.reference}{payment.providerRef ? ` · Provider ref ${payment.providerRef}` : ""}</p>
          <PrintButton />
        </CardBody>
      </Card>
    </div>
  );
}
