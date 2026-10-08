"use client";
import { useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/ui/fields";
import { ACTIVITY_LABELS, bmiBand, dailyTargets, GOAL_LABELS, validStats, type Activity, type Goal, type Sex } from "@/lib/nutrition";

/** Daily calorie and macro estimate from body stats. Runs entirely in the browser; nothing is saved or sent. */
export function DietCalculator({ initialGoal = "GENERAL_HEALTH" }: { initialGoal?: Goal }) {
  const [sex, setSex] = useState<Sex>("male");
  const [age, setAge] = useState("25");
  const [weight, setWeight] = useState("70");
  const [height, setHeight] = useState("170");
  const [activity, setActivity] = useState<Activity>("moderate");
  const [goal, setGoal] = useState<Goal>(initialGoal);
  const stats = { sex, ageYears: Number(age), weightKg: Number(weight), heightCm: Number(height), activity, goal };
  const t = useMemo(() => (validStats(stats) ? dailyTargets(stats) : null), [sex, age, weight, height, activity, goal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Sex" htmlFor="dc-sex"><Select id="dc-sex" value={sex} onChange={(e) => setSex(e.target.value as Sex)}><option value="male">Male</option><option value="female">Female</option></Select></Field>
        <Field label="Age" htmlFor="dc-age"><Input id="dc-age" type="number" inputMode="numeric" min={14} max={90} value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Field label="Weight (kg)" htmlFor="dc-w"><Input id="dc-w" type="number" inputMode="decimal" min={30} max={250} value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        <Field label="Height (cm)" htmlFor="dc-h"><Input id="dc-h" type="number" inputMode="numeric" min={120} max={230} value={height} onChange={(e) => setHeight(e.target.value)} /></Field>
        <Field label="Activity" htmlFor="dc-a"><Select id="dc-a" value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>{Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Goal" htmlFor="dc-g"><Select id="dc-g" value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>{Object.entries(GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {t ? (
        <div aria-live="polite" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Calories / day" value={`${t.calories}`} sub={`Maintenance ≈ ${t.maintenance}`} />
          <Stat label="Protein" value={`${t.proteinG} g`} sub="Eggs, dal, paneer, chicken" />
          <Stat label="Carbs" value={`${t.carbsG} g`} sub="Rice, roti, fruit" />
          <Stat label="Fat" value={`${t.fatG} g`} sub="Ghee, oil, nuts" />
          <Stat label="Water" value={`${(t.waterMl / 1000).toFixed(1)} L`} sub="More on training days" />
          <Stat label="BMI" value={`${t.bmi}`} sub={bmiBand(t.bmi)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Enter age 14–90, weight 30–250 kg and height 120–230 cm.</p>
      )}
      <p className="mt-4 text-xs text-ink-3">An estimate to start from (Mifflin-St Jeor). Your trainer can adjust it. Not medical advice — check with a doctor if you have a health condition or are pregnant.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="num display mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-ink-3">{sub}</p>
    </div>
  );
}
