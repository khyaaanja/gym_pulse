import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Gift, MapPin, Phone, Sparkles } from "lucide-react";
import { tenantDb } from "@/db/tenant";
import { PublicShell } from "@/components/public/public-shell";
import { PublicForm } from "@/components/public/public-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { firstName, livePromotions, publicGym, referrerByCode } from "@/services/growth";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { whatsappLink } from "@/lib/phone";
import { GOAL_LABELS } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 40) : undefined);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gym = await publicGym((await params).slug);
  if (!gym) return { title: "Gym not found" };
  const description = gym.cfg.publicPage.tagline ?? `Join ${gym.name}${gym.city ? ` in ${gym.city}` : ""}. See plans and offers, and book a free trial.`;
  return { title: gym.name, description, openGraph: { title: gym.name, description, type: "website" } };
}

const durationLabel = (days: number) => (days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} days`);

export default async function GymPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const gym = await publicGym(slug);
  if (!gym) notFound();
  const page = gym.cfg.publicPage;
  const db = tenantDb(gym.id);
  const ref = one(sp.ref);
  const promoId = one(sp.promo);
  const [plans, promotions, referrer] = await Promise.all([
    db.membershipPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }], select: { id: true, name: true, description: true, durationDays: true, pricePaisa: true } }),
    livePromotions(gym.id, { publicOnly: true }),
    referrerByCode(db, ref),
  ]);
  const highlighted = promotions.find((p) => p.id === promoId);
  const carry = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ ref: referrer ? ref : undefined, promo: highlighted?.id, ...extra }).filter((e): e is [string, string] => !!e[1]));
    return q.size ? `?${q}` : "";
  };
  const wa = gym.phone ? whatsappLink(gym.phone, `Hi ${gym.name}, I saw your page on GymPulse and want to know more.`) : null;
  const sym = gym.currencySymbol;

  return (
    <PublicShell wide>
      <section className="bg-dusk relative overflow-hidden rounded-[2rem] px-6 py-10 text-white sm:px-10 sm:py-14">
        {gym.city && <p className="flex items-center gap-1.5 text-sm text-white/80"><MapPin className="size-4" aria-hidden /> {gym.city}{gym.province ? `, ${gym.province}` : ""}</p>}
        <h1 className="display mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">{gym.name}</h1>
        {page.tagline && <p className="mt-3 max-w-xl text-lg text-white/85">{page.tagline}</p>}
        <div className="mt-7 flex flex-wrap gap-3">
          {page.allowSelfSignup && <Button asChild size="lg"><Link href={`/g/${gym.slug}/join${carry({})}`}>Join online</Link></Button>}
          <Button asChild size="lg" variant="secondary"><a href="#trial">Book a free trial</a></Button>
        </div>
      </section>

      {referrer && (
        <p className="mt-5 flex items-start gap-3 rounded-2xl bg-brand-soft p-4 text-[15px] text-ink">
          <Gift className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <span><strong>{firstName(referrer.fullName)}</strong> invited you to train at {gym.name}.{gym.cfg.growth.referralReward ? ` ${gym.cfg.growth.referralReward}` : ""}</span>
        </p>
      )}

      {promotions.length > 0 && (
        <section aria-labelledby="offers-h" className="mt-10">
          <h2 id="offers-h" className="display flex items-center gap-2 text-2xl font-bold"><Sparkles className="size-6 text-brand" aria-hidden /> Current offers</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {promotions.map((p) => (
              <Card key={p.id} className={p.id === highlighted?.id ? "ring-2 ring-brand" : undefined}>
                <CardBody>
                  {p.badge && <Badge tone="brand">{p.badge}</Badge>}
                  <p className="display mt-2 text-xl font-bold">{p.title}</p>
                  {p.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{p.description}</p>}
                  <dl className="mt-3 space-y-1 text-sm text-ink-2">
                    {p.plan && <div><dt className="inline font-medium">Plan: </dt><dd className="inline">{p.plan.name}{page.showPrices ? ` · ${formatMoney(p.plan.pricePaisa, sym)}` : ""}</dd></div>}
                    {p.coupon?.active && <div><dt className="inline font-medium">Code: </dt><dd className="num inline rounded bg-surface-2 px-1.5 py-0.5 font-semibold">{p.coupon.code}</dd></div>}
                    {p.endsAt && <div><dt className="inline font-medium">Ends: </dt><dd className="inline">{formatDate(p.endsAt, undefined, gym.timezone)}</dd></div>}
                  </dl>
                  <Button asChild size="sm" className="mt-4">
                    {page.allowSelfSignup ? <Link href={`/g/${gym.slug}/join${carry({ promo: p.id })}`}>Claim this offer</Link> : <a href={`/g/${gym.slug}${carry({ promo: p.id })}#trial`}>Ask about this offer</a>}
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      {page.showPrices && plans.length > 0 && (
        <section aria-labelledby="plans-h" className="mt-10">
          <h2 id="plans-h" className="display text-2xl font-bold">Membership plans</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.id}>
                <CardBody>
                  <p className="font-semibold">{p.name}</p>
                  <p className="num display mt-1 text-3xl font-extrabold">{formatMoney(p.pricePaisa, sym)}</p>
                  <p className="text-sm text-ink-3">{durationLabel(p.durationDays)}</p>
                  {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}
                  {page.allowSelfSignup && <Button asChild size="sm" variant="secondary" className="mt-4"><Link href={`/g/${gym.slug}/join${carry({ plan: p.id })}`}>Choose</Link></Button>}
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          {page.about && (
            <section aria-labelledby="about-h">
              <h2 id="about-h" className="display text-2xl font-bold">About us</h2>
              <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{page.about}</p>
            </section>
          )}
          {page.amenities.length > 0 && (
            <section aria-labelledby="amen-h">
              <h2 id="amen-h" className="display text-xl font-bold">What you get</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {page.amenities.map((a) => <li key={a} className="rounded-full bg-surface px-3 py-1.5 text-sm ring-1 ring-line">{a}</li>)}
              </ul>
            </section>
          )}
          <section aria-labelledby="visit-h" className="space-y-2 text-[15px] text-ink-2">
            <h2 id="visit-h" className="display text-xl font-bold text-ink">Visit</h2>
            {page.openingHours && <p className="flex items-start gap-2 whitespace-pre-line"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> {page.openingHours}</p>}
            {gym.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {gym.address}{gym.city ? `, ${gym.city}` : ""}</p>}
            {gym.phone && <p className="flex items-center gap-2"><Phone className="size-4" aria-hidden /> <a className="font-medium text-brand underline underline-offset-4" href={`tel:+977${gym.phone}`}>{gym.phone}</a>{wa && <> · <a className="font-medium text-brand underline underline-offset-4" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</p>}
          </section>
        </div>

        <section id="trial" aria-labelledby="trial-h" className="scroll-mt-6">
          <Card>
            <CardBody>
              <h2 id="trial-h" className="display text-2xl font-bold">Book a free trial</h2>
              <p className="mt-1 text-sm text-ink-3">Leave your number and {gym.name} will call you to fix a time.</p>
              <PublicForm
                className="mt-5"
                endpoint={`/api/public/gyms/${gym.slug}/leads`}
                submit="Request my free trial"
                hidden={{ ref: referrer ? ref : undefined, promo: highlighted?.id }}
                fields={[
                  { name: "name", label: "Your name", required: true, autoComplete: "name" },
                  { name: "phone", label: "Mobile", type: "tel", autoComplete: "tel", hint: "Nepal mobile, e.g. 98XXXXXXXX" },
                  { name: "email", label: "Email (optional)", type: "email", autoComplete: "email" },
                  { name: "goal", label: "Your main goal", type: "select", options: Object.values(GOAL_LABELS).map((g) => ({ value: g, label: g })) },
                  { name: "preferredVisitOn", label: "When would you like to come?", type: "date" },
                  { name: "message", label: "Anything we should know?", type: "textarea", placeholder: "e.g. beginner, knee injury, evenings only" },
                ]}
              />
              <p className="mt-3 text-xs text-ink-3">{gym.name} uses your details only to contact you about joining. <Link className="underline" href="/legal/privacy">Privacy</Link></p>
            </CardBody>
          </Card>
        </section>
      </div>
    </PublicShell>
  );
}
