import { Droplets, Salad, UtensilsCrossed } from "lucide-react";
import type { MemberContext } from "@/lib/api";
import { prisma } from "@/db/client";
import { readMeals } from "@/services/diet";
import { GOAL_LABELS } from "@/lib/nutrition";
import { formatDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { DietCalculator } from "./diet-calculator";

/** The member's current diet plan from their gym, past plans, and a calorie calculator. */
export async function MemberDiet({ ctx }: { ctx: MemberContext }) {
  const plans = await ctx.db.dietPlan.findMany({ where: { memberId: ctx.member.id, isTemplate: false }, orderBy: { createdAt: "desc" }, take: 10 });
  const current = plans.find((p) => p.active);
  const past = plans.filter((p) => p !== current);
  const coach = current?.createdById ? await prisma.staffMember.findFirst({ where: { id: current.createdById, gymId: ctx.gym.id }, select: { user: { select: { name: true } } } }) : null;
  const meals = current ? readMeals(current.meals) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-ink-3">Diet</p>
        <h1 className="display text-3xl font-semibold">{current ? current.title : "Your diet plan"}</h1>
      </div>
      {current ? (
        <>
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{GOAL_LABELS[current.goal]}</Badge>
                <span className="text-sm text-ink-3">{coach ? `From ${coach.user.name}` : `From ${ctx.gym.name}`} · {formatDate(current.updatedAt, undefined, ctx.gym.timezone)}</span>
              </div>
              {(current.dailyCalories || current.proteinG || current.waterMl) && (
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {current.dailyCalories != null && <Target label="Calories" value={`${current.dailyCalories}`} />}
                  {current.proteinG != null && <Target label="Protein" value={`${current.proteinG} g`} />}
                  {current.carbsG != null && <Target label="Carbs" value={`${current.carbsG} g`} />}
                  {current.fatG != null && <Target label="Fat" value={`${current.fatG} g`} />}
                  {current.waterMl != null && <Target label="Water" value={`${(current.waterMl / 1000).toFixed(1)} L`} icon={<Droplets className="size-3.5" aria-hidden />} />}
                </dl>
              )}
            </CardBody>
          </Card>
          {meals.length > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><UtensilsCrossed className="size-5 text-brand" aria-hidden /> Your day</span>} />
              <ol className="divide-y divide-line">
                {meals.map((m, i) => (
                  <li key={i} className="flex gap-4 px-5 py-4">
                    <span className="num w-16 shrink-0 pt-0.5 text-sm font-semibold text-ink-3">{m.time}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{m.name}{m.calories ? <span className="num ml-2 text-sm font-normal text-ink-3">~{m.calories} kcal</span> : null}</p>
                      <p className="mt-0.5 text-[15px] text-ink-2">{m.items}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {current.notes && <Card><CardBody><p className="whitespace-pre-line text-sm text-ink-2">{current.notes}</p></CardBody></Card>}
        </>
      ) : (
        <Card><EmptyState icon={<Salad />} title="No diet plan yet" body={`Ask your trainer at ${ctx.gym.name} for one. Meanwhile, the calculator below gives you a starting point.`} /></Card>
      )}
      <Card>
        <CardHeader title="Calorie & protein calculator" description="See roughly how much to eat for your goal." />
        <CardBody><DietCalculator initialGoal={current?.goal ?? "GENERAL_HEALTH"} /></CardBody>
      </Card>
      {past.length > 0 && (
        <Card>
          <CardHeader title="Earlier plans" />
          <ul className="divide-y divide-line">
            {past.map((p) => <li key={p.id} className="flex justify-between px-5 py-3 text-sm"><span>{p.title}</span><span className="text-ink-3">{formatDate(p.createdAt, undefined, ctx.gym.timezone)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Target({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <dt className="flex items-center gap-1 text-xs font-medium text-ink-3">{icon}{label}</dt>
      <dd className="num display mt-1 text-xl font-bold">{value}</dd>
    </div>
  );
}
