import Link from "next/link";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";
import { PolicyNote } from "@/components/legal/policy-note";
import { GoogleButton, OrDivider, googleError } from "@/components/auth/google-button";
import { prisma } from "@/db/client";
import { platformSetting } from "@/services/content";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Create your gym" };

export default async function Signup({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const problem = googleError(sp.error);
  const [plans, defaultKey, trialDays] = await Promise.all([
    prisma.saasPlan.findMany({ where: { isPublic: true, active: true }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true, pricePaisa: true, billingPeriod: true, freeMonths: true } }),
    platformSetting("platform.defaultPlan", "starter"),
    platformSetting("platform.trialDays", 14),
  ]);
  const wanted = typeof sp.plan === "string" ? sp.plan : defaultKey;
  const plan = plans.find((p) => p.key === wanted) ?? plans.find((p) => p.key === defaultKey) ?? plans[0];
  const free = (p: { freeMonths: number }) => (p.freeMonths > 0 ? `${p.freeMonths} month${p.freeMonths === 1 ? "" : "s"} free` : `${trialDays} days free`);
  const subtitle = plan
    ? `${plan.name}: ${free(plan)}, then ${formatMoney(plan.pricePaisa)}/${plan.billingPeriod === "YEARLY" ? "year" : "month"}. No card needed.`
    : `Free for ${trialDays} days. No card needed.`;

  return (
    <AuthShell title="Create your gym" subtitle={subtitle} footer={<>Already on GymPulse? <Link className="font-medium text-brand underline underline-offset-4" href="/login">Sign in</Link></>}>
      {plans.length > 1 && (
        <nav aria-label="Choose a plan" className="mb-7 grid grid-cols-3 gap-2">
          {plans.map((p) => {
            const on = p.key === plan?.key;
            return (
              <Link
                key={p.key}
                href={`/signup?plan=${encodeURIComponent(p.key)}`}
                aria-current={on ? "true" : undefined}
                scroll={false}
                replace
                className={cn("rounded-2xl px-3 py-2.5 text-center ring-1 transition-colors", on ? "bg-brand-soft ring-brand text-ink" : "bg-surface ring-line text-ink-2 hover:ring-ink-3")}
              >
                <span className="block text-sm font-semibold">{p.name}</span>
                <span className={cn("block text-xs", on ? "text-brand" : "text-ink-3")}>{free(p)}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {problem && <p role="alert" className="mb-4 rounded-xl bg-risk-soft px-3.5 py-2.5 text-sm text-risk">{problem}</p>}
      <GoogleButton next={plan ? `/signup/gym?plan=${encodeURIComponent(plan.key)}` : "/signup/gym"} label="Sign up with Google" />
      <OrDivider />
      <AuthForm
        endpoint="/api/auth/signup"
        submit="Create gym"
        extra={plan ? { plan: plan.key } : undefined}
        fields={[
          { name: "gymName", label: "Gym name" },
          { name: "city", label: "City", required: false },
          { name: "ownerName", label: "Your name", autoComplete: "name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "phone", label: "Mobile", type: "tel", autoComplete: "tel", required: false, hint: "Nepal mobile, e.g. 98XXXXXXXX" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." },
        ]}
      />
      <PolicyNote kind="signup" className="mt-4" />
    </AuthShell>
  );
}
