import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";

export const metadata = { title: "Set up your gym" };

/** Onboarding checklist. Each step is "done" from real data, not from clicking a box. */
export default async function Onboarding() {
  const ctx = await requireStaff("settings.manage");
  const g = ctx.gym;
  const raw = (g.settings ?? {}) as Record<string, unknown>;
  const [plans, members, providers, products, notifs, attendanceCount] = await Promise.all([
    ctx.db.membershipPlan.count({ where: { active: true } }),
    ctx.db.member.count({ where: { archivedAt: null } }),
    prisma.paymentProviderConfig.count({ where: { gymId: g.id, enabled: true } }),
    ctx.db.marketplaceProduct.count(),
    prisma.notificationProviderConfig.count({ where: { enabled: true } }),
    ctx.db.attendance.count(),
  ]);
  const steps = [
    { t: "Create your gym", d: "Done when you signed up.", done: true, href: null },
    { t: "Gym information", d: "Phone, address and city members will see.", done: !!(g.phone && g.address), href: "/app/settings?tab=profile" },
    { t: "Upload your logo", d: "Shown on receipts and the member app.", done: !!g.logoFileId, href: "/app/settings?tab=profile" },
    { t: "Create membership plans", d: "Monthly, quarterly, annual — with NPR prices.", done: plans > 0, href: "/app/settings?tab=plans" },
    { t: "Import existing records or add members", d: "Upload Excel/CSV/PDF or photograph your register. This also gives you your first churn estimate.", done: members > 0, href: "/app/imports/new", primary: true },
    { t: "Configure attendance", d: "At-risk threshold, self check-in and the kiosk QR.", done: "attendance" in raw || attendanceCount > 0, href: "/app/settings?tab=rules" },
    { t: "Configure notifications", d: notifs ? "SMS/email are available on GymPulse." : "Renewal reminders go in-app until SMS or email is set up by GymPulse.", done: "renewal" in raw, href: "/app/settings?tab=rules" },
    { t: "Connect payments", d: "Your eSewa or Khalti merchant account, for online renewals.", done: providers > 0, href: "/app/settings?tab=payments" },
    { t: "Set up the marketplace", d: "Optional — PT packs, classes, merchandise.", done: products > 0 || !ctx.flags.marketplace, href: "/app/marketplace" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="display text-3xl font-semibold">Set up {g.name}</h1>
      <p className="mt-1 text-ink-3">{doneCount} of {steps.length} done. You can come back to this anytime from Settings.</p>
      <Card className="mt-6">
        <ol className="divide-y divide-line">
          {steps.map((s, i) => (
            <li key={s.t} className="flex items-start gap-4 px-5 py-4">
              {s.done ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-label="Done" /> : <Circle className="mt-0.5 size-6 shrink-0 text-ink-3" aria-label="Not done" />}
              <div className="flex-1">
                <p className="font-medium"><span className="num mr-2 text-ink-3">{i + 1}.</span>{s.t}</p>
                <p className="text-sm text-ink-3">{s.d}</p>
              </div>
              {s.href && !s.done && <Button asChild size="sm" variant={s.primary ? "primary" : "secondary"}><Link href={s.href}>{s.primary ? "Analyze existing records" : "Set up"}</Link></Button>}
            </li>
          ))}
        </ol>
        <CardBody className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">{plans > 0 && members > 0 ? "You're ready to go." : "Add plans and members before launching."}</p>
            <ActionButton method="PATCH" endpoint="/api/gym/onboarding" body={{ step: 10, done: true }} disabled={!(plans > 0 && members > 0)} success="You're live!" redirectTo="/app">Launch</ActionButton>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
