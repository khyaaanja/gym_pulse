import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Gift, Megaphone, Printer, Sparkles, UserPlus } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { gymSettings } from "@/config/gym-settings";
import { growthStats, livePromotionWhere } from "@/services/growth";
import { formatDate, localDate } from "@/lib/time";
import { whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Metric } from "@/components/ui/metric";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { CopyButton } from "@/components/app/copy-button";

export const metadata = { title: "Grow" };

const STATUS = {
  NEW: { label: "New", tone: "brand" },
  CONTACTED: { label: "Contacted", tone: "warn" },
  TRIAL_BOOKED: { label: "Trial booked", tone: "ok" },
  CONVERTED: { label: "Joined", tone: "ok" },
  LOST: { label: "Not joining", tone: "neutral" },
} as const;
const SOURCE: Record<string, string> = { PUBLIC_PAGE: "Gym page", REFERRAL: "Referral", PROMOTION: "Offer", WALK_IN: "Walk-in", PHONE: "Phone", SOCIAL: "Social media", OTHER: "Other" };
const FILTERS = ["OPEN", "NEW", "CONTACTED", "TRIAL_BOOKED", "CONVERTED", "LOST"] as const;

export default async function Grow({ searchParams }: PageProps<"/app/grow">) {
  const ctx = await requireStaff();
  const canLeads = ctx.can("leads.manage");
  const canPromos = ctx.can("promotions.manage");
  if (!canLeads && !canPromos) redirect("/app/forbidden");
  const canSettings = ctx.can("settings.manage");
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(String(sp.status)) ? (String(sp.status) as (typeof FILTERS)[number]) : "OPEN";
  const cfg = gymSettings(ctx.gym.settings);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const pageUrl = `${base}/g/${ctx.gym.slug}`;

  const [stats, leads, promotions, coupons, plans] = await Promise.all([
    growthStats(ctx.gym.id),
    canLeads
      ? ctx.db.lead.findMany({
          where: filter === "OPEN" ? { status: { in: ["NEW", "CONTACTED", "TRIAL_BOOKED"] } } : { status: filter },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { referrer: { select: { fullName: true } }, promotion: { select: { title: true } } },
        })
      : [],
    canPromos ? ctx.db.gymPromotion.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }], include: { coupon: { select: { code: true } }, plan: { select: { name: true } } } }) : [],
    canPromos ? prisma.coupon.findMany({ where: { gymId: ctx.gym.id, active: true }, orderBy: { createdAt: "desc" }, select: { id: true, code: true } }) : [],
    canPromos ? ctx.db.membershipPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const live = canPromos ? new Set((await ctx.db.gymPromotion.findMany({ where: livePromotionWhere(), select: { id: true } })).map((p) => p.id)) : new Set<string>();

  const pageFields: FieldSpec[] = [
    { name: "enabled", label: "Publish my gym page", type: "checkbox", defaultValue: cfg.publicPage.enabled },
    { name: "allowSelfSignup", label: "Let people join online (they create an account, then pay for a plan)", type: "checkbox", defaultValue: cfg.publicPage.allowSelfSignup },
    { name: "listInDirectory", label: "List my gym on the GymPulse \"Find a gym\" page", type: "checkbox", defaultValue: cfg.publicPage.listInDirectory },
    { name: "showPrices", label: "Show plan prices", type: "checkbox", defaultValue: cfg.publicPage.showPrices },
    { name: "tagline", label: "Tagline", defaultValue: cfg.publicPage.tagline ?? null, placeholder: "Pokhara's friendliest strength gym", hint: "One line under your gym's name." },
    { name: "about", label: "About your gym", type: "textarea", defaultValue: cfg.publicPage.about ?? null, placeholder: "Trainers, equipment, classes, who you're great for…" },
    { name: "openingHours", label: "Opening hours", type: "textarea", defaultValue: cfg.publicPage.openingHours ?? null, placeholder: "Sun–Fri 5:30 AM – 9 PM\nSat 7 AM – 12 PM" },
    { name: "amenities", label: "What members get (one per line)", type: "list", defaultValue: cfg.publicPage.amenities.join("\n"), placeholder: "Free weights\nCardio zone\nPersonal training\nLockers\nParking" },
  ];
  const promoFields = (p?: (typeof promotions)[number]): FieldSpec[] => [
    { name: "title", label: "Headline", required: true, defaultValue: p?.title, placeholder: "Dashain offer: 3 months for the price of 2" },
    { name: "description", label: "Details", type: "textarea", defaultValue: p?.description ?? null, placeholder: "New members only. Includes a free diet plan." },
    { name: "badge", label: "Badge", defaultValue: p?.badge ?? null, placeholder: "20% OFF", hint: "A few words shown on the card and poster." },
    { name: "couponId", label: "Discount coupon", type: "select", defaultValue: p?.couponId ?? null, options: coupons.map((c) => ({ value: c.id, label: c.code })), hint: coupons.length ? "Applied at checkout when someone joins through this offer." : "Create a coupon under Marketplace → Coupons to attach a discount." },
    { name: "planId", label: "Plan", type: "select", defaultValue: p?.planId ?? null, options: plans.map((x) => ({ value: x.id, label: x.name })), hint: "Pre-selected when someone joins through this offer." },
    { name: "startsAt", label: "Starts", type: "date", defaultValue: p?.startsAt ? localDate(p.startsAt, ctx.gym.timezone) : null },
    { name: "endsAt", label: "Ends", type: "date", defaultValue: p?.endsAt ? localDate(p.endsAt, ctx.gym.timezone) : null, hint: "A deadline makes people act. The offer hides itself after this day." },
    { name: "showOnPublicPage", label: "Show on my gym page and poster", type: "checkbox", defaultValue: p?.showOnPublicPage ?? true },
    { name: "active", label: "Active", type: "checkbox", defaultValue: p?.active ?? true },
  ];
  const leadFields: FieldSpec[] = [
    { name: "name", label: "Name", required: true },
    { name: "phone", label: "Mobile", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "goal", label: "Goal", placeholder: "Lose weight, build muscle…" },
    { name: "source", label: "How did they find you?", type: "select", required: true, defaultValue: "WALK_IN", options: ["WALK_IN", "PHONE", "SOCIAL", "REFERRAL", "OTHER"].map((v) => ({ value: v, label: SOURCE[v]! })) },
    { name: "preferredVisitOn", label: "Trial date", type: "date" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const shareText = (offer?: string) => `${offer ? `${offer} at ${ctx.gym.name}! ` : `Train with us at ${ctx.gym.name}! `}Book your free trial: `;

  return (
    <>
      <PageHeader
        title="Grow"
        description="Bring in new members: your public gym page, offers, enquiries and referrals."
        actions={canLeads ? <FormDialog trigger={<Button><UserPlus /> Log a walk-in</Button>} title="New enquiry" description="Someone visited or called? Log them so they get a follow-up." endpoint="/api/gym/leads" fields={leadFields} transform="gym.lead" successMessage="Enquiry saved" /> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Enquiries" value={stats.leads} period="Last 30 days" definition="Free-trial requests from your page plus walk-ins and calls staff logged." />
        <Metric label="Became members" value={stats.conversionPct === null ? "—" : `${stats.conversionPct}%`} period={`${stats.converted} of ${stats.leads} enquiries`} definition="Enquiries from the last 30 days that are now members." />
        <Metric label="Joined online" value={stats.selfSignups} period="Last 30 days" definition="People who created their own account from your gym page." />
        <Metric label="Joined by referral" value={stats.referred} period="Last 30 days" definition="New members who came through a member's invite link." />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Your gym page"
          description={cfg.publicPage.enabled ? "Share it everywhere: WhatsApp status, Facebook, Instagram bio, Google Maps listing." : "Turn it on so people can see your plans and offers, book a free trial, and join online."}
          action={canSettings ? <FormDialog trigger={<Button size="sm" variant="secondary">Edit page</Button>} title="Your gym page" description="Address, phone and city come from Settings → Gym profile." endpoint="/api/gym/settings" method="PATCH" fields={pageFields} transform="gym.publicPage" successMessage="Gym page saved" /> : undefined}
        />
        <CardBody>
          {cfg.publicPage.enabled ? (
            <div className="space-y-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone="ok" dot>Live</Badge>
                {cfg.publicPage.allowSelfSignup ? <Badge tone="brand">Online joining on</Badge> : <Badge>Enquiries only</Badge>}
                <a href={pageUrl} target="_blank" rel="noopener" className="num break-all text-sm font-medium text-brand underline underline-offset-4">{pageUrl}</a>
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={pageUrl} />
                <Button asChild size="sm" variant="secondary"><a href={`https://wa.me/?text=${encodeURIComponent(shareText() + pageUrl)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button>
                <Button asChild size="sm" variant="secondary"><a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noopener noreferrer">Share on Facebook</a></Button>
                <Button asChild size="sm" variant="secondary"><a href={`/g/${ctx.gym.slug}/poster`} target="_blank" rel="noopener"><Printer /> Print poster with QR</a></Button>
                <Button asChild size="sm" variant="ghost"><a href={pageUrl} target="_blank" rel="noopener"><ExternalLink /> Open</a></Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">{canSettings ? "Your page is off. Click Edit page to publish it." : "Ask the owner to publish the gym page in Grow → Edit page."}</p>
          )}
        </CardBody>
      </Card>

      {canLeads && (
        <section aria-labelledby="leads-h" className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="leads-h" className="display text-xl font-semibold">Enquiries</h2>
            <nav aria-label="Filter enquiries" className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Link key={f} href={`/app/grow?status=${f}`} scroll={false} aria-current={filter === f ? "page" : undefined} className={cn("rounded-full px-3 py-1.5 text-sm", filter === f ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-surface-2")}>
                  {f === "OPEN" ? "To follow up" : STATUS[f].label}
                </Link>
              ))}
            </nav>
          </div>
          {leads.length === 0 ? (
            <Card><EmptyState icon={<Megaphone />} title={filter === "OPEN" ? "No one waiting for a call" : "Nothing here"} body={cfg.publicPage.enabled ? "New free-trial requests from your gym page show up here — call them within a day, while they're keen." : "Publish your gym page so people can request a free trial. Walk-ins you log also show up here."} /></Card>
          ) : (
            <div className="space-y-3">
              {leads.map((l) => {
                const wa = l.phone ? whatsappLink(l.phone, `Namaste ${l.name.split(" ")[0]}, this is ${ctx.user.name} from ${ctx.gym.name}. Thanks for your interest! When would you like to come for your free trial?`) : null;
                return (
                  <Card key={l.id}>
                    <CardBody className="flex flex-wrap items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{l.name}</p>
                          <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                          <Badge>{SOURCE[l.source]}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-2">
                          {l.phone && <a className="num font-medium text-brand underline underline-offset-2" href={`tel:+977${l.phone}`}>{l.phone}</a>}
                          {l.phone && l.email && " · "}
                          {l.email && <a className="text-brand underline underline-offset-2" href={`mailto:${l.email}`}>{l.email}</a>}
                          {wa && <> · <a className="font-medium text-brand underline underline-offset-2" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}
                        </p>
                        <p className="mt-1 text-sm text-ink-3">
                          {[l.goal && `Goal: ${l.goal}`, l.preferredVisitOn && `Wants to come ${formatDate(l.preferredVisitOn)}`, l.referrer && `Referred by ${l.referrer.fullName}`, l.promotion && `Offer: ${l.promotion.title}`, `Asked ${formatDate(l.createdAt, undefined, ctx.gym.timezone)}`].filter(Boolean).join(" · ")}
                        </p>
                        {l.message && <p className="mt-2 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm">{l.message}</p>}
                        {l.notes && <p className="mt-2 text-sm text-ink-2">Notes: {l.notes}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {l.status === "CONVERTED" ? (
                          l.convertedMemberId && <Button asChild size="sm" variant="secondary"><Link href={`/app/members/${l.convertedMemberId}`}>Open member</Link></Button>
                        ) : (
                          <>
                            {l.status === "NEW" && <ActionButton size="sm" variant="secondary" method="PATCH" endpoint={`/api/gym/leads/${l.id}`} body={{ status: "CONTACTED" }} success="Marked as contacted">Contacted</ActionButton>}
                            {l.status !== "TRIAL_BOOKED" && <ActionButton size="sm" variant="secondary" method="PATCH" endpoint={`/api/gym/leads/${l.id}`} body={{ status: "TRIAL_BOOKED" }} success="Trial booked">Trial booked</ActionButton>}
                            {ctx.can("members.edit") && <ActionButton size="sm" method="POST" endpoint={`/api/gym/leads/${l.id}/convert`} confirm={`Add ${l.name} as a member? You can then add their plan or send the app invite.`} success="Member added">Make member</ActionButton>}
                            <FormDialog trigger={<Button size="sm" variant="ghost">Notes</Button>} title={`Notes on ${l.name}`} endpoint={`/api/gym/leads/${l.id}`} method="PATCH" fields={[{ name: "notes", label: "Notes", type: "textarea", defaultValue: l.notes }]} />
                            {l.status !== "LOST" && <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/leads/${l.id}`} body={{ status: "LOST" }} success="Marked as not joining">Not joining</ActionButton>}
                          </>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      {canPromos && (
        <section aria-labelledby="offers-h" className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="offers-h" className="display flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-5 text-brand" aria-hidden /> Offers</h2>
            <FormDialog trigger={<Button size="sm">New offer</Button>} title="New offer" description="Shown on your gym page and poster, with a link you can share." endpoint="/api/gym/promotions" fields={promoFields()} transform="gym.promotion" transformArgs={{ tz: ctx.gym.timezone }} successMessage="Offer saved" />
          </div>
          {promotions.length === 0 ? (
            <Card><EmptyState icon={<Sparkles />} title="No offers yet" body="Festivals (Dashain, Tihar, New Year), bring-a-friend months and student discounts bring people in. Give each a deadline." /></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {promotions.map((p) => {
                const link = `${pageUrl}?promo=${p.id}`;
                return (
                  <Card key={p.id}>
                    <CardBody>
                      <div className="flex flex-wrap items-center gap-2">
                        {live.has(p.id) ? <Badge tone="ok" dot>Live</Badge> : <Badge>{p.active ? "Scheduled / ended" : "Off"}</Badge>}
                        {p.badge && <Badge tone="brand">{p.badge}</Badge>}
                        {!p.showOnPublicPage && <Badge>Link only</Badge>}
                      </div>
                      <p className="mt-2 font-semibold">{p.title}</p>
                      {p.description && <p className="mt-1 text-sm text-ink-2">{p.description}</p>}
                      <p className="mt-2 text-xs text-ink-3">
                        {[p.coupon && `Coupon ${p.coupon.code}`, p.plan && `Plan ${p.plan.name}`, p.startsAt && `From ${formatDate(p.startsAt, undefined, ctx.gym.timezone)}`, p.endsAt && `Until ${formatDate(p.endsAt, undefined, ctx.gym.timezone)}`, `${stats.joinsByPromotion[p.id] ?? 0} joined through it`].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        <CopyButton text={link} label="Copy offer link" />
                        <Button asChild size="sm" variant="secondary"><a href={`https://wa.me/?text=${encodeURIComponent(shareText(p.title) + link)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></Button>
                        <Button asChild size="sm" variant="ghost"><a href={`/g/${ctx.gym.slug}/poster?promo=${p.id}`} target="_blank" rel="noopener"><Printer /> Poster</a></Button>
                        <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title="Edit offer" endpoint={`/api/gym/promotions/${p.id}`} method="PATCH" fields={promoFields(p)} transform="gym.promotion" transformArgs={{ tz: ctx.gym.timezone }} />
                        <ActionButton size="sm" variant="ghost" method="DELETE" endpoint={`/api/gym/promotions/${p.id}`} confirm="Delete this offer? Shared links will stop showing it." success="Offer deleted">Delete</ActionButton>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="ref-h" className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={<span id="ref-h" className="flex items-center gap-2"><Gift className="size-5 text-brand" aria-hidden /> Member referrals</span>}
            description="Every member has a personal invite link on their home screen. Friends who use it are tagged to them."
            action={canSettings ? <FormDialog trigger={<Button size="sm" variant="secondary">Set reward</Button>} title="Referral reward" endpoint="/api/gym/settings" method="PATCH" transform="gym.referral" fields={[{ name: "referralReward", label: "What do they get?", defaultValue: cfg.growth.referralReward ?? null, placeholder: "You both get 1 week free when your friend joins.", hint: "Shown on the member's invite card and your gym page. You hand out the reward at the desk." }]} successMessage="Reward saved" /> : undefined}
          />
          <CardBody>
            <p className="text-sm text-ink-2">{cfg.growth.referralReward ? <>Reward: <strong>{cfg.growth.referralReward}</strong></> : "No reward set. A small, clear reward (a free week, a shaker, a PT session) makes members share."}</p>
            {stats.topReferrers.length > 0 && (
              <ol className="mt-4 space-y-2">
                {stats.topReferrers.map((r, i) => r.member && (
                  <li key={r.member.id} className="flex items-center justify-between text-sm">
                    <span><span className="num mr-2 text-ink-3">{i + 1}.</span><Link className="font-medium hover:underline" href={`/app/members/${r.member.id}`}>{r.member.fullName}</Link></span>
                    <span className="num font-semibold">{r.count} joined</span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What works for gyms like yours" />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              <li>Reply to every enquiry the same day — most people join where they were called first.</li>
              <li>Put the poster QR at the counter, the entrance, and the shop next door.</li>
              <li>Run one offer at a time with an end date (festivals, new year, exam break for students).</li>
              <li>Ask happy members to share their invite link — then thank top referrers publicly.</li>
              <li>Post a member transformation (with permission) on Facebook/Instagram with your page link.</li>
              <li>Add your page link to your Google Maps listing and Instagram bio.</li>
            </ul>
          </CardBody>
        </Card>
      </section>
    </>
  );
}
