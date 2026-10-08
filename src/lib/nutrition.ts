/**
 * Daily energy and macro targets from body stats. Mifflin-St Jeor for resting energy, standard activity multipliers,
 * then a goal adjustment. These are starting points a trainer refines, not medical advice.
 */
export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "LOSE_FAT" | "BUILD_MUSCLE" | "MAINTAIN" | "PERFORMANCE" | "GENERAL_HEALTH";

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: "Mostly sitting (desk job, little exercise)",
  light: "Light (exercise 1–3 days a week)",
  moderate: "Moderate (exercise 3–5 days a week)",
  active: "Active (hard training 6–7 days a week)",
  very_active: "Very active (training twice a day or physical job)",
};

export const GOAL_LABELS: Record<Goal, string> = {
  LOSE_FAT: "Lose fat",
  BUILD_MUSCLE: "Build muscle",
  MAINTAIN: "Maintain weight",
  PERFORMANCE: "Sports performance",
  GENERAL_HEALTH: "General health",
};

const MULTIPLIER: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
const GOAL_FACTOR: Record<Goal, number> = { LOSE_FAT: 0.8, BUILD_MUSCLE: 1.1, MAINTAIN: 1, PERFORMANCE: 1.05, GENERAL_HEALTH: 1 };
/** Protein grams per kg of body weight. */
const PROTEIN_PER_KG: Record<Goal, number> = { LOSE_FAT: 2, BUILD_MUSCLE: 1.8, MAINTAIN: 1.4, PERFORMANCE: 1.6, GENERAL_HEALTH: 1.2 };
/** Never suggest less than this, whatever the goal: very low intakes need a clinician. */
const FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

export type BodyStats = { sex: Sex; ageYears: number; weightKg: number; heightCm: number; activity: Activity; goal: Goal };

export type Targets = { bmr: number; maintenance: number; calories: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; bmi: number };

export function validStats(s: BodyStats): boolean {
  return s.ageYears >= 14 && s.ageYears <= 90 && s.weightKg >= 30 && s.weightKg <= 250 && s.heightCm >= 120 && s.heightCm <= 230 && s.activity in MULTIPLIER && s.goal in GOAL_FACTOR;
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function bmiBand(value: number): string {
  if (value < 18.5) return "Underweight";
  if (value < 23) return "Healthy";
  // WHO's Asian cut-offs: risk rises from 23, not 25.
  if (value < 27.5) return "Overweight";
  return "Obese";
}

export function dailyTargets(s: BodyStats): Targets {
  if (!validStats(s)) throw new RangeError("Body stats are out of range");
  const bmr = 10 * s.weightKg + 6.25 * s.heightCm - 5 * s.ageYears + (s.sex === "male" ? 5 : -161);
  const maintenance = bmr * MULTIPLIER[s.activity];
  const calories = Math.max(FLOOR_KCAL[s.sex], Math.round((maintenance * GOAL_FACTOR[s.goal]) / 10) * 10);
  const proteinG = Math.round(s.weightKg * PROTEIN_PER_KG[s.goal]);
  const fatG = Math.round((calories * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  const waterMl = Math.round((s.weightKg * 35) / 100) * 100;
  return { bmr: Math.round(bmr), maintenance: Math.round(maintenance), calories, proteinG, carbsG, fatG, waterMl, bmi: bmi(s.weightKg, s.heightCm) };
}

/** Calories implied by macros (4/4/9 kcal per gram). */
export const macroCalories = (p: number, c: number, f: number) => p * 4 + c * 4 + f * 9;
