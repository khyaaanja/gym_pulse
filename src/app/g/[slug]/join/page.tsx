import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tenantDb } from "@/db/tenant";
import { getUserSession } from "@/lib/auth/session";
import { PublicShell } from "@/components/public/public-shell";
import { PublicForm, type PublicField } from "@/components/public/public-form";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { PolicyNote } from "@/components/legal/policy-note";
import { SwitchGymButton } from "@/components/public/switch-gym-button";
import { firstName, livePromotions, publicGym, referrerByCode } from "@/services/growth";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 40) : undefined);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gym = await publicGym((await params).slug);
  return { title: gym ? `Join ${gym.name}` : "Gym not found", robots: { index: false } };
}

export default async function Join({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const gym = await publicGym(slug);
  if (!gym) notFound();
  if (!gym.cfg.publicPage.allowSelfSignup) redirect(`/g/${gym.slug}#trial`);
  const db = tenantDb(gym.id);
  const session = await getUserSession();
  const [plans, promotions, referrer, membership] = await Promise.all([
    db.membershipPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }], select: { id: true, name: true, pricePaisa: true } }),
    livePromotions(gym.id, { publicOnly: true }),
    referrerByCode(db, one(sp.ref)),
    session ? db.member.findFirst({ where: { userId: session.userId, archivedAt: null }, select: { id: true } }) : null,
  ]);
  if (membership && session) {
    return (
      <PublicShell>
        <h1 className="display text-3xl font-extrabold">You&apos;re already a member of {gym.name}</h1>
        <p className="mt-2 text-ink-3">Open the app to see your pass, streaks and diet plan.</p>
        <SwitchGymButton gymId={gym.id} />
      </PublicShell>
    );
  }
  const promo = promotions.find((p) => p.id === one(sp.promo));
  const wantedPlan = one(sp.plan) ?? promo?.plan?.id;
  const here = `/g/${gym.slug}/join${Object.keys(sp).length ? `?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))}` : ""}`;

  const planField: PublicField[] = plans.length
    ? [{ name: "planId", label: "Choose your plan", type: "radio", defaultValue: wantedPlan, options: plans.map((p) => ({ value: p.id, label: p.name, detail: gym.cfg.publicPage.showPrices ? formatMoney(p.pricePaisa, gym.currencySymbol) : undefined })) }]
    : [];
  const fields: PublicField[] = session
    ? [{ name: "name", label: "Your name", required: true, defaultValue: session.user.name, autoComplete: "name" }, ...(session.user.phone ? [] : [{ name: "phone", label: "Mobile", type: "tel" as const, autoComplete: "tel", hint: "So the gym can reach you. Nepal mobile, e.g. 98XXXXXXXX" }]), ...planField]
    : [
        { name: "name", label: "Your name", required: true, autoComplete: "name" },
        { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
        { name: "phone", label: "Mobile", type: "tel", autoComplete: "tel", hint: "Nepal mobile, e.g. 98XXXXXXXX" },
        { name: "password", label: "Password", type: "password", required: true, autoComplete: "new-password", hint: "At least 10 characters." },
        ...planField,
      ];

  return (
    <PublicShell>
      <p className="text-sm text-ink-3"><Link href={`/g/${gym.slug}`} className="underline underline-offset-4">{gym.name}</Link></p>
      <h1 className="display mt-1 text-3xl font-extrabold">Join {gym.name}</h1>
      <p className="mt-2 text-ink-3">Create your account, then pay for your plan online or at the front desk. You&apos;ll get your check-in pass, streaks and diet plan in the app.</p>
      {referrer && <p className="mt-4 rounded-2xl bg-brand-soft p-4 text-sm">Invited by <strong>{firstName(referrer.fullName)}</strong>.{gym.cfg.growth.referralReward ? ` ${gym.cfg.growth.referralReward}` : ""}</p>}
      {promo && <p className="mt-4 rounded-2xl bg-ok-soft p-4 text-sm text-ok">Offer: <strong>{promo.title}</strong>{promo.coupon?.active ? ` — code ${promo.coupon.code} is applied at checkout.` : ""}</p>}

      <div className="mt-8">
        {session ? (
          <p className="mb-5 rounded-2xl bg-surface p-4 text-sm ring-1 ring-line">Joining as <strong>{session.user.name}</strong> ({session.user.email ?? session.user.phone}). <Link className="text-brand underline" href={`/login?next=${encodeURIComponent(here)}`}>Not you?</Link></p>
        ) : (
          <>
            <GoogleButton next={here} label="Join with Google" />
            <OrDivider />
          </>
        )}
        <PublicForm
          endpoint={`/api/public/gyms/${gym.slug}/join`}
          submit={session ? `Join ${gym.name}` : "Create account and join"}
          hidden={{ ref: referrer ? one(sp.ref) : undefined, promo: promo?.id }}
          signInHref={`/login?next=${encodeURIComponent(here)}`}
          fields={fields}
        />
        <PolicyNote kind="invite" className="mt-4" />
        {!session && <p className="mt-4 text-sm text-ink-3">Already have a GymPulse account? <Link className="font-medium text-brand underline underline-offset-4" href={`/login?next=${encodeURIComponent(here)}`}>Sign in first</Link></p>}
      </div>
    </PublicShell>
  );
}
