import Link from "next/link";
import { redirect } from "next/navigation";
import { Salad } from "lucide-react";
import { appMode } from "@/lib/page-auth";
import { memberScope } from "@/lib/scope";
import { mealsToText, readMeals } from "@/services/diet";
import { GOAL_LABELS } from "@/lib/nutrition";
import { formatDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { MemberDiet } from "@/components/app/member-diet";
import { DietCalculator } from "@/components/app/diet-calculator";

export const metadata = { title: "Diet plans" };

const GOALS = Object.entries(GOAL_LABELS).map(([value, label]) => ({ value, label }));
const MEALS_HINT = "One meal per line: time | meal | what to eat | kcal. Example: 8:00 | Breakfast | 2 eggs, 1 roti, black tea | 300";

type PlanLike = { title: string; goal: string; dailyCalories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; waterMl: number | null; meals: unknown; notes: string | null };

const planFields = (p?: PlanLike): FieldSpec[] => [
  { name: "title", label: "Plan name", required: true, defaultValue: p?.title, placeholder: "Fat loss — 1800 kcal" },
  { name: "goal", label: "Goal", type: "select", required: true, defaultValue: p?.goal ?? "GENERAL_HEALTH", options: GOALS },
  { name: "dailyCalories", label: "Calories per day", type: "number", defaultValue: p?.dailyCalories ?? null },
  { name: "proteinG", label: "Protein (g)", type: "number", defaultValue: p?.proteinG ?? null },
  { name: "carbsG", label: "Carbs (g)", type: "number", defaultValue: p?.carbsG ?? null },
  { name: "fatG", label: "Fat (g)", type: "number", defaultValue: p?.fatG ?? null },
  { name: "waterMl", label: "Water (ml)", type: "number", defaultValue: p?.waterMl ?? null },
  { name: "meals", label: "Meals", type: "textarea", required: true, defaultValue: p ? mealsToText(readMeals(p.meals)) : null, hint: MEALS_HINT },
  { name: "notes", label: "Notes for the member", type: "textarea", defaultValue: p?.notes ?? null, placeholder: "Swap rice for roti at dinner. Avoid sugary tea." },
];

const macros = (p: PlanLike) => [p.dailyCalories && `${p.dailyCalories} kcal`, p.proteinG && `P ${p.proteinG} g`, p.carbsG && `C ${p.carbsG} g`, p.fatG && `F ${p.fatG} g`].filter(Boolean).join(" · ");

export default async function Diet() {
  const mode = await appMode();
  if (mode.kind === "member") return <MemberDiet ctx={mode.ctx} />;
  if (mode.kind !== "staff") redirect("/login");
  const ctx = mode.ctx;
  if (!ctx.can("diet.manage")) redirect("/app/forbidden");

  // Trainers see and assign only their own members' plans.
  const scope = memberScope(ctx);
  const [templates, assigned, members] = await Promise.all([
    ctx.db.dietPlan.findMany({ where: { isTemplate: true }, orderBy: { title: "asc" } }),
    ctx.db.dietPlan.findMany({ where: { isTemplate: false, active: true, member: { archivedAt: null, ...scope } }, orderBy: { updatedAt: "desc" }, take: 200, include: { member: { select: { id: true, fullName: true, memberCode: true } } } }),
    ctx.db.member.findMany({ where: { archivedAt: null, ...scope }, orderBy: { fullName: "asc" }, take: 1000, select: { id: true, fullName: true, memberCode: true } }),
  ]);
  const memberOptions = members.map((m) => ({ value: m.id, label: `${m.fullName} (${m.memberCode})` }));
  const assignFields = (templateId?: string): FieldSpec[] => [
    { name: "memberId", label: "Member", type: "select", required: true, options: memberOptions },
    { name: "templateId", label: "Template", type: "select", required: true, defaultValue: templateId ?? null, options: templates.map((t) => ({ value: t.id, label: t.title })) },
  ];

  return (
    <>
      <PageHeader
        title="Diet plans"
        description="Reusable templates, and the plan each member sees in their app. Members get a notification when you give them one."
        actions={
          <div className="flex flex-wrap gap-2">
            <FormDialog trigger={<Button variant="secondary">New template</Button>} title="New diet template" endpoint="/api/gym/diet-plans" fields={planFields()} transform="gym.dietTemplate" successMessage="Template saved" />
            {templates.length > 0 && memberOptions.length > 0 && <FormDialog trigger={<Button>Give a plan</Button>} title="Give a member a diet plan" description="They get a copy, so later edits to the template don't change it." endpoint="/api/gym/diet-plans" fields={assignFields()} transform="gym.dietAssign" successMessage="Plan sent to the member" submitLabel="Give plan" />}
          </div>
        }
      />

      <section aria-labelledby="tpl-h">
        <h2 id="tpl-h" className="display mb-3 text-xl font-semibold">Templates</h2>
        {templates.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Salad />}
              title="No templates yet"
              body="Start from four ready-made plans built around Nepali home food (dal bhat, roti, chana, paneer) — edit them to suit your gym."
              action={<ActionButton endpoint="/api/gym/diet-plans/starter" success="Starter templates added">Add starter templates</ActionButton>}
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id}>
                <CardBody>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{t.title}</p><Badge tone="brand">{GOAL_LABELS[t.goal]}</Badge></div>
                  <p className="mt-1 text-sm text-ink-3">{macros(t) || "No targets set"} · {readMeals(t.meals).length} meals</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {memberOptions.length > 0 && <FormDialog trigger={<Button size="sm">Give to member</Button>} title={`Give "${t.title}"`} endpoint="/api/gym/diet-plans" fields={assignFields(t.id)} transform="gym.dietAssign" successMessage="Plan sent to the member" submitLabel="Give plan" />}
                    <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title="Edit template" endpoint={`/api/gym/diet-plans/${t.id}`} method="PATCH" fields={planFields(t)} transform="gym.dietTemplate" transformArgs={{ edit: true }} />
                    <ActionButton size="sm" variant="ghost" method="DELETE" endpoint={`/api/gym/diet-plans/${t.id}`} confirm="Delete this template? Plans already given to members stay as they are." success="Template deleted">Delete</ActionButton>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="asg-h" className="mt-8">
        <h2 id="asg-h" className="display mb-3 text-xl font-semibold">Members on a plan</h2>
        {assigned.length === 0 ? (
          <Card><CardBody><p className="text-sm text-ink-3">No member has a plan yet. Give one from a template above.</p></CardBody></Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {assigned.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/members/${p.member!.id}`} className="font-medium hover:underline">{p.member!.fullName}</Link>
                    <p className="text-sm text-ink-3">{p.title} · {macros(p) || GOAL_LABELS[p.goal]} · updated {formatDate(p.updatedAt, undefined, ctx.gym.timezone)}</p>
                  </div>
                  <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={`${p.member!.fullName}'s plan`} endpoint={`/api/gym/diet-plans/${p.id}`} method="PATCH" fields={planFields(p)} transform="gym.dietTemplate" transformArgs={{ edit: true }} />
                  <ActionButton size="sm" variant="ghost" method="DELETE" endpoint={`/api/gym/diet-plans/${p.id}`} confirm="End this plan? The member keeps it in their history." success="Plan ended">End</ActionButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <Card className="mt-8">
        <CardHeader title="Calorie & macro calculator" description="Work out targets from a member's stats, then put them in their plan." />
        <CardBody><DietCalculator /></CardBody>
      </Card>
    </>
  );
}
