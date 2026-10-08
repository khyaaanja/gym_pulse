import Link from "next/link";
import { Gift, Megaphone, Salad, Trophy } from "lucide-react";
import type { MemberContext } from "@/lib/api";
import { attendanceSummary } from "@/services/attendance";
import { contextualSuggestion } from "@/services/marketplace";
import { visibleAnnouncements } from "@/services/announcements";
import { gymSettings } from "@/config/gym-settings";
import { diffDays, formatDate, fromDbDate, today as todayIn } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MemberPass } from "./member-pass";
import { StreakCard } from "./streak-card";
import { CopyButton } from "./copy-button";
import { ensureReferralCode } from "@/services/growth";

export async function MemberHome({ ctx }: { ctx: MemberContext }) {
  const today = todayIn(ctx.gym.timezone);
  const [s, ms, news] = await Promise.all([
    attendanceSummary(ctx.gym, ctx.member.id, today),
    ctx.db.membership.findFirst({ where: { memberId: ctx.member.id, status: { in: ["ACTIVE", "EXPIRED"] } }, orderBy: { endDate: "desc" }, include: { plan: true } }),
    visibleAnnouncements(ctx.user.id, ctx.gym.id),
  ]);
  const cfg = gymSettings(ctx.gym.settings);
  const [diet, referral] = await Promise.all([
    ctx.db.dietPlan.findFirst({ where: { memberId: ctx.member.id, active: true, isTemplate: false }, orderBy: { createdAt: "desc" }, select: { title: true } }),
    // Invite links only work while the gym's public page is on.
    cfg.publicPage.enabled
      ? Promise.all([ensureReferralCode(ctx.db, ctx.member), ctx.db.member.count({ where: { referredById: ctx.member.id } })]).then(([code, joined]) => ({ link: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/g/${ctx.gym.slug}?ref=${code}`, joined }))
      : null,
  ]);
  const suggestion = ctx.flags.marketplace && cfg.marketplace.contextualSuggestions ? await contextualSuggestion(ctx.gym.id, s.currentStreak) : null;
  const daysLeft = ms ? diffDays(today, fromDbDate(ms.endDate)) : null;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <p className="text-ink-3">Namaste, {ctx.member.fullName.split(" ")[0]}</p>
        <h1 className="display text-3xl font-semibold">{ctx.gym.name}</h1>
      </div>

      <StreakCard today={today} calendar={s.calendar} currentStreak={s.currentStreak} bestStreak={s.bestStreak} nextMilestone={s.nextMilestone} maxGap={s.maxGap} />

      <div className="grid grid-cols-2 gap-3">
        <MemberPass checkedIn={s.checkedInToday} />
        <Button asChild variant="secondary" size="lg" className="h-auto flex-col gap-1 py-4">
          <Link href="/app/attendance"><Trophy /> Challenges</Link>
        </Button>
      </div>

      {ms && (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">{ms.plan.name} membership</p>
            {daysLeft !== null && daysLeft >= 0 ? (
              <p className="display mt-1 text-2xl font-semibold">{daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}</p>
            ) : (
              <p className="display mt-1 text-2xl font-semibold text-risk">Expired {formatDate(fromDbDate(ms.endDate))}</p>
            )}
            <p className="mt-1 text-sm text-ink-3">Valid until {formatDate(fromDbDate(ms.endDate))} · {formatMoney(ms.plan.pricePaisa, ctx.gym.currencySymbol)}</p>
            {daysLeft !== null && daysLeft <= 14 && <Button asChild size="lg" className="mt-4 w-full"><Link href="/app/renew">Renew now</Link></Button>}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex items-center gap-4">
          <Salad className="size-8 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{diet ? diet.title : "Diet plan"}</p>
            <p className="text-sm text-ink-3">{diet ? "Your meals and daily targets from the gym." : "Work out your calories and protein, or ask your trainer for a plan."}</p>
          </div>
          <Button asChild variant="secondary" size="sm"><Link href="/app/diet">Open</Link></Button>
        </CardBody>
      </Card>

      {referral && (
        <Card>
          <CardBody>
            <p className="flex items-center gap-2 font-semibold"><Gift className="size-5 text-brand" aria-hidden /> Bring a friend</p>
            <p className="mt-1 text-sm text-ink-2">{cfg.growth.referralReward ?? `Training is better together. Share your link — your friend can book a free trial at ${ctx.gym.name}.`}</p>
            {referral.joined > 0 && <p className="mt-1 text-sm font-medium text-ok">{referral.joined} friend{referral.joined === 1 ? "" : "s"} joined with your link</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm"><a href={`https://wa.me/?text=${encodeURIComponent(`Come train with me at ${ctx.gym.name}! Book a free trial here: ${referral.link}`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button>
              <CopyButton text={referral.link} />
            </div>
          </CardBody>
        </Card>
      )}

      {suggestion && (
        <Card>
          <CardBody>
            <p className="text-[15px]">{suggestion.message}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="num font-semibold">{formatMoney(suggestion.product.pricePaisa, ctx.gym.currencySymbol)}</span>
              <Button asChild variant="secondary" size="sm"><Link href={`/app/marketplace?product=${suggestion.product.id}`}>See details</Link></Button>
            </div>
          </CardBody>
        </Card>
      )}

      {news.length > 0 && (
        <section aria-labelledby="news-h">
          <h2 id="news-h" className="display mb-2 mt-2 flex items-center gap-2 text-lg font-semibold"><Megaphone className="size-5 text-brand" aria-hidden /> From {ctx.gym.name}</h2>
          <Card>
            <ul className="divide-y divide-line">
              {news.slice(0, 5).map((n) => (
                <li key={n.id} className="px-5 py-4">
                  <p className="font-semibold">{n.title}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{n.body}</p>
                  {n.publishAt && <p className="mt-1.5 text-xs text-ink-3">{formatDate(n.publishAt, undefined, ctx.gym.timezone)}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
