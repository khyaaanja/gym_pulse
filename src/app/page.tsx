import Link from "next/link";
import { Activity, Camera, FileSpreadsheet, HeartPulse, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { prisma } from "@/db/client";
import { publishedContent, platformSetting } from "@/services/content";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PulseTrace } from "@/components/ui/pulse-trace";
import { GymScene } from "@/components/three/gym-scene";
import { GymHud } from "@/components/three/gym-hud";
import { Pricing } from "@/components/marketing/pricing";
import { RecordsCheck } from "@/components/marketing/records-check";
import { Words } from "@/components/marketing/words";
import { formatMoney } from "@/lib/money";

export const dynamic = "auto";

type Hero = { eyebrow?: string; title: string; subtitle: string; primaryCta: string; secondaryCta: string };
type Features = { items: { title: string; body: string }[] };
type Faqs = { items: { q: string; a: string }[] };
type Cta = { title: string; body: string; button: string };

const ICONS = [HeartPulse, FileSpreadsheet, Wallet, Activity, Sparkles, ShieldCheck];

export default async function Landing() {
  const [hero, features, faqs, cta, plans, custom, roi, trialDays] = await Promise.all([
    publishedContent<Hero>("WEBSITE", "hero"),
    publishedContent<Features>("WEBSITE", "features"),
    publishedContent<Faqs>("WEBSITE", "faqs"),
    publishedContent<Cta>("WEBSITE", "cta"),
    prisma.saasPlan.findMany({ where: { isPublic: true, active: true }, orderBy: { sortOrder: "asc" } }),
    platformSetting("pricing.customDeployment", { setupMinPaisa: 3_000_000, setupMaxPaisa: 5_000_000, maintenanceMinPaisa: 200_000, maintenanceMaxPaisa: 500_000 }),
    platformSetting("roi.example", { membersRetained: 20, monthlyFeePaisa: 150_000, months: 12, buildShareBps: 1000 }),
    platformSetting("platform.trialDays", 14),
  ]);
  const h = hero ?? { eyebrow: "For gyms in Nepal", title: "Know which members may leave — before they go.", subtitle: "GymPulse reads your attendance and membership records. Every day it shows you who to call, how much money is at risk, and who came back.", primaryCta: "Start free trial", secondaryCta: "See how it works" };
  const annual = roi.membersRetained * roi.monthlyFeePaisa * roi.months;
  const sample = [3, 5, 4, 6, 2, 5, 7, 4, 3, 6, 5, 2, 1, 3, 1, 0, 2, 1, 0, 0, 1, 0, 0, 0];

  return (
    <div data-own-motion className="gym-night relative isolate min-h-dvh bg-[#0a0812]">
      {/* The stage: one fixed WebGL film behind the whole page. Each [data-gym-chapter] below is a chapter; scrolling
          directs the camera and the lift. The dark floor colour stands in wherever WebGL can't run. */}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(70%_60%_at_70%_40%,#2a1636_0%,#0a0812_70%)]">
        <GymScene mode="page" className="absolute inset-0" label="Illustration: a lifter training in a gym at night, moving through a session as you scroll" />
      </div>
      <GymHud />
      <a href="#main" className="sr-only z-50 rounded-full bg-white px-4 py-2 font-semibold text-[#0a0812] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <header className="site-header fixed inset-x-0 top-0 z-40 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          {/* Below 390px the wordmark would push the account buttons off screen; the mark (and its "GymPulse home" label) stays. */}
          <Logo className="[&_rect]:fill-white/10 [&_rect]:stroke-white/20 max-[389px]:[&>span]:hidden" />
          {/* From 1024px only: on a portrait tablet the four links wrapped to two and three lines and doubled the header. */}
          <nav className="hidden items-center gap-1 whitespace-nowrap text-sm font-medium text-white/80 lg:flex" aria-label="Sections">
            {[["#how", "How it works"], ["#pricing", "Pricing"], ["#faq", "Questions"], ["#check", "Free records check"]].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 transition-colors hover:bg-white/10 hover:text-white">{label}</a>
            ))}
          </nav>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Button asChild variant="ghost" size="sm" className="text-white/85 hover:bg-white/10 hover:text-white"><Link href="/login">Sign in</Link></Button>
            <Button asChild size="sm"><Link href="/signup">{h.primaryCta}</Link></Button>
          </nav>
        </div>
      </header>
      <main id="main">
      {/* Content boxes alternate left and right down the page; each chapter's shot puts the lifter on the other side.
          Chapter 1 — deadlift, copy on the left, lifter on the right: the promise. */}
      <div data-gym-chapter="deadlift" data-gym-shot="hero" className="relative text-white">
        {/* Keeps the headline readable over the film at every width. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_40%,transparent_70%)] bg-[linear-gradient(90deg,rgb(10_8_18/0.62)_0%,rgb(10_8_18/0.28)_40%,transparent_62%)] max-lg:bg-[linear-gradient(180deg,rgb(10_8_18/0.55)_0%,rgb(10_8_18/0.2)_55%,rgb(10_8_18/0.45)_100%)]" />
        <section className="mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-4 pb-24 pt-28 sm:px-6">
          <div className="scroll-3d-exit max-w-2xl">
            {h.eyebrow && <p className="text-[15px] font-medium text-[#ffb4d3]">{h.eyebrow}</p>}
            <h1 className="display mt-3 max-w-[14ch] text-balance text-[42px] font-extrabold leading-[0.98] sm:text-[72px]">{h.title}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">{h.subtitle}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/signup">{h.primaryCta}</Link></Button>
              <Button asChild size="lg" variant="ghost" className="text-white ring-1 ring-white/25 hover:bg-white/10 hover:text-white"><a href="#how">{h.secondaryCta}</a></Button>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70">
              {["No card needed", "Cancel any time", "Your data stays yours"].map((t) => (
                <li key={t} className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#63d6a4]" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <p aria-hidden className="mt-16 flex items-center gap-3 text-xs font-semibold tracking-[0.22em] text-white/55">
            <span className="relative grid h-9 w-6 justify-center rounded-full ring-1 ring-white/30"><span className="cue-drop mt-1.5 block h-2 w-[3px] rounded-full bg-[#ffb454]" /></span>
            SCROLL TO SEE MORE
          </p>
        </section>
      </div>

      {/* Chapter 2 — the deadlift from the other side: what's at stake on the right, the lifter on the left. */}
      <div data-gym-chapter="deadlift" data-gym-shot="mirror" className="relative text-white">
        <section aria-labelledby="stake-h" className="mx-auto grid min-h-[110svh] max-w-6xl items-center gap-10 px-4 py-24 sm:px-6 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="lg:col-start-2">
            <h2 id="stake-h" className="kinetic display max-w-[16ch] text-balance text-4xl font-extrabold leading-[1.02] sm:text-6xl">
              <Words text="Members rarely quit in one day. They miss one visit, then another." />
            </h2>
            {/* Product illustration with example data (clearly labelled). */}
            <figure className="scroll-3d relative mt-10 w-full min-w-0 max-w-sm">
              <div className="glass rounded-[2rem] p-5">
                <p className="text-sm font-medium text-white/70">Money at risk</p>
                <p className="display num mt-1 text-5xl font-extrabold text-[#ff9a80]">Rs. 34,500</p>
                <p className="mt-1 text-sm text-white/60">23 members · this month</p>
                <PulseTrace values={sample} className="mt-4 h-14 w-full" tone="#ff6a9f" label="Example: visits falling over 24 days" />
                <ul className="mt-4 space-y-2">
                  {[["Rahul Sharma", "Away 13 days · plan ends in 8 days", "Rs. 1,500"], ["Sita Rai", "Away 11 days · visits down 52%", "Rs. 1,500"], ["Bikash Tamang", "Away 16 days", "Rs. 1,500"]].map(([n, d, f]) => (
                    <li key={n} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/10">
                      <span className="grid size-9 place-items-center rounded-full bg-[#ff6a47]/20 text-xs font-semibold text-[#ffb3a1]">{n!.split(" ").map((p) => p[0]).join("")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n}</span>
                        <span className="block text-xs text-white/60">{d}</span>
                      </span>
                      <span className="num text-sm font-medium">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <figcaption className="mt-3 text-center text-xs text-white/60">Example only — not real members</figcaption>
            </figure>
          </div>
        </section>
      </div>

      {/* Chapter 3 — bent-over row in profile: copy on the left, lifter on the right. */}
      <section id="how" aria-labelledby="how-h" data-gym-chapter="row" data-gym-shot="profile" className="py-28">
        <div className="mx-auto grid max-w-6xl px-4 sm:px-6 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <h2 id="how-h" className="kinetic display max-w-3xl text-balance text-4xl font-extrabold leading-[1.05] sm:text-5xl"><Words text="Find who is missing. Call them. Win them back." /></h2>
            <div className="glass scroll-3d mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[1.75rem] sm:grid-cols-2">
              {(features?.items ?? []).map((f, i) => {
                const Icon = ICONS[i % ICONS.length]!;
                return (
                  <div key={f.title} className="bg-white/[0.02] p-6 ring-1 ring-white/[0.05]">
                    <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-5" aria-hidden /></span>
                    <h3 className="display mt-5 text-xl font-bold">{f.title}</h3>
                    <p className="mt-2 leading-relaxed text-ink-2">{f.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Chapter 4 — barbell curl, close: copy on the right, lifter on the left. */}
      <section aria-labelledby="import-h" data-gym-chapter="curl" data-gym-shot="close" className="mx-auto grid min-h-[100svh] max-w-6xl content-center px-4 py-28 sm:px-6 grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="glass rounded-[2rem] p-7 sm:p-9 lg:col-start-2">
          <h2 id="import-h" className="kinetic display text-balance text-4xl font-extrabold leading-[1.05]"><Words text="Already have records? Bring them." /></h2>
          <p className="scroll-3d mt-4 text-lg text-ink-2">An Excel sheet, a PDF, or a photo of the paper register at your front desk. We read it, show you every row we are not sure about, and import only the rows you approve.</p>
          <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              [FileSpreadsheet, "Upload", "CSV, Excel or PDF"],
              [Camera, "Or take a photo", "Paper registers work too"],
              [ShieldCheck, "Check", "Fix unclear rows and choose what to do with repeats"],
              [HeartPulse, "See the risk", "Who may leave, shown as a range"],
            ].map(([Icon, t, d], i) => {
              const I = Icon as typeof Camera;
              return (
                <li key={String(t)} className="scroll-3d rounded-[1.5rem] bg-white/[0.04] p-5 ring-1 ring-white/10">
                  <div className="flex items-center justify-between">
                    <span className="display num text-3xl font-extrabold text-brand/40">{i + 1}</span>
                    <I className="size-5 text-brand" aria-hidden />
                  </div>
                  <p className="mt-3 font-semibold">{String(t)}</p>
                  <p className="text-sm text-ink-3">{String(d)}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Chapter 5 — overhead press seen from above; pricing spans the frame (three plans side by side). */}
      <div data-gym-chapter="press" data-gym-shot="overhead">
      <Pricing
        plans={plans}
        trialDays={trialDays}
        footer={
          <div className="glass scroll-3d mt-12 grid grid-cols-1 gap-6 rounded-[1.75rem] p-7 md:grid-cols-2">
            <div>
              <p className="font-semibold">Your own private setup</p>
              <p className="mt-1 text-sm text-white/70">GymPulse on its own server, just for your gym. Setup costs about {formatMoney(custom.setupMinPaisa)}–{formatMoney(custom.setupMaxPaisa)}, then {formatMoney(custom.maintenanceMinPaisa)}–{formatMoney(custom.maintenanceMaxPaisa)} a month for upkeep.</p>
            </div>
            <div>
              <p className="font-semibold">An example, not a promise</p>
              <p className="mt-1 text-sm text-white/70">If {roi.membersRetained} members who pay {formatMoney(roi.monthlyFeePaisa)} a month stay one more year, your gym keeps {formatMoney(annual)} it would have lost. Results are different for every gym.</p>
            </div>
          </div>
        }
      />
      </div>

      {/* Chapter 6 — overhead hold from a low angle: questions on the left, lifter on the right. */}
      <section id="faq" aria-labelledby="faq-h" data-gym-chapter="lockout" data-gym-shot="low" className="mx-auto grid min-h-[100svh] max-w-6xl content-center px-4 py-24 sm:px-6 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="glass rounded-[2rem] p-7 sm:p-9">
          <h2 id="faq-h" className="kinetic display text-3xl font-extrabold sm:text-4xl"><Words text="Questions gym owners ask" /></h2>
          {faqs?.items?.length ? (
          <div className="mt-6 divide-y divide-line">
            {faqs.items.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold marker:hidden">{f.q}<span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 transition-transform group-open:rotate-45">+</span></summary>
                <p className="mt-2 leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
          ) : (
            <p className="mt-4 text-ink-2">Have a question? Start the free trial and see your own numbers.</p>
          )}
        </div>
      </section>

      {/* Chapter 7 — back squat, wide and low: the whole room, the final call on the right, the lifter on the left
          (above the card on phones) where the card never covers the last set. */}
      <section id="check" aria-labelledby="cta-h" data-gym-chapter="squat" data-gym-shot="wide" className="mx-auto flex min-h-[120svh] max-w-6xl flex-col justify-end px-4 pb-20 sm:px-6">
        {/* The free records check lives here: an owner can analyse their own register without an account. */}
        {/* suppressHydrationWarning: the first-load hand-off script (motion/handoff.ts) may tag it before hydration. */}
        <div suppressHydrationWarning className="glass scroll-3d relative isolate overflow-hidden rounded-[2.5rem] px-6 py-12 text-white sm:px-12 lg:ml-auto lg:w-full lg:max-w-[42rem]">
            <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-96 rounded-full bg-[radial-gradient(closest-side,rgb(255_79_152/0.35),transparent)]" />
            <h2 id="cta-h" className="kinetic display max-w-xl text-balance text-4xl font-extrabold leading-[1.05] sm:text-5xl"><Words text={cta?.title ?? "See your money at risk in minutes."} /></h2>
            <p className="mt-4 max-w-xl text-white/80">{cta?.body ?? "Add your attendance register or member list and see who may stop coming. It is free, you don't need an account, and nothing is saved."}</p>
            <RecordsCheck maxMb={Number(process.env.MAX_UPLOAD_MB ?? 10)} />
          </div>
      </section>

      </main>

      <footer className="glass border-x-0 border-b-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-3 sm:px-6">
          <Logo />
          <nav className="flex flex-wrap gap-5" aria-label="Legal">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/refund">Refunds</Link>
            <Link href="/legal/marketplace_terms">Marketplace terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
