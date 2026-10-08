import { z } from "zod";
import type { TenantDb } from "@/db/tenant";
import { notFound } from "@/lib/errors";
import type { DietGoal } from "@/generated/prisma/enums";

export const mealSchema = z.object({
  time: z.string().trim().max(20).default(""),
  name: z.string().trim().min(1, "Name each meal.").max(60),
  items: z.string().trim().min(1, "List what to eat.").max(600),
  calories: z.number().int().min(0).max(5000).nullable().optional(),
});
export type Meal = z.infer<typeof mealSchema>;

const int = (max: number) => z.number().int().min(0).max(max).nullable().optional();

const goal = z.enum(["LOSE_FAT", "BUILD_MUSCLE", "MAINTAIN", "PERFORMANCE", "GENERAL_HEALTH"]);
const planFields = {
  title: z.string().trim().min(2, "Give the plan a name.").max(80),
  dailyCalories: int(8000),
  proteinG: int(600),
  carbsG: int(1200),
  fatG: int(400),
  waterMl: int(10_000),
  notes: z.string().trim().max(2000).nullable().optional(),
};

export const dietPlanSchema = z.object({ ...planFields, goal: goal.default("GENERAL_HEALTH"), meals: z.array(mealSchema).max(12).default([]) });

/** For edits: no defaults, so a field that isn't sent is left as it is (partial() would still fill defaults in). */
export const dietPlanPatchSchema = z.object({ ...planFields, goal, meals: z.array(mealSchema).max(12) }).partial();
export type DietPlanInput = z.infer<typeof dietPlanSchema>;

/** Meals as the editable text the diet forms use (`time | meal | what to eat | kcal`); parsed back by parseMeals. */
export const mealsToText = (meals: Meal[]) => meals.map((m) => [m.time, m.name, m.items, m.calories ?? ""].join(" | ").replace(/ \| $/, "")).join("\n");

/** Reads the stored meals defensively: rows written by older code or by hand never break the page. */
export function readMeals(raw: unknown): Meal[] {
  const parsed = z.array(mealSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Gives a member a plan, either a copy of a template (edits to the template later don't change it) or written from
 * scratch. A member has one current plan; the previous one is kept as history.
 */
export async function assignDietPlan(db: TenantDb, gymId: string, memberId: string, source: { templateId?: string | null; plan?: DietPlanInput | null }, createdById: string | null) {
  let data: DietPlanInput;
  if (source.templateId) {
    const t = await db.dietPlan.findFirst({ where: { id: source.templateId, isTemplate: true } });
    if (!t) throw notFound("Template not found.");
    data = { title: t.title, goal: t.goal, dailyCalories: t.dailyCalories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, waterMl: t.waterMl, meals: readMeals(t.meals), notes: t.notes };
  } else if (source.plan) {
    data = source.plan;
  } else {
    throw notFound("Choose a template or write a plan.");
  }
  await db.dietPlan.updateMany({ where: { memberId, active: true }, data: { active: false } });
  return db.dietPlan.create({ data: { ...data, gymId, memberId, isTemplate: false, active: true, createdById } });
}

const NOTE = "General guidance, not medical advice. If you have diabetes, high blood pressure, kidney problems, are pregnant, or take regular medicine, check with your doctor first.";

/** Ready-made templates built around everyday Nepali food, so a new gym has something to assign on day one. */
export const STARTER_TEMPLATES: (DietPlanInput & { goal: DietGoal })[] = [
  {
    title: "Fat loss — Nepali home food",
    goal: "LOSE_FAT",
    dailyCalories: 1800, proteinG: 130, carbsG: 180, fatG: 55, waterMl: 3000,
    meals: [
      { time: "6:30", name: "Wake up", items: "1 glass warm water, 5 soaked almonds", calories: 40 },
      { time: "8:00", name: "Breakfast", items: "2 boiled eggs (or 100 g paneer bhurji), 1 roti, black tea without sugar", calories: 300 },
      { time: "11:00", name: "Snack", items: "1 apple, guava or orange", calories: 80 },
      { time: "13:30", name: "Lunch", items: "1 small bowl rice (100 g cooked), big bowl dal, saag, 150 g chicken/fish curry or 100 g paneer, cucumber–radish salad", calories: 600 },
      { time: "17:00", name: "Before training", items: "1 banana, black coffee", calories: 110 },
      { time: "19:00", name: "After training", items: "Roasted chana (40 g) or 1 scoop whey in water", calories: 150 },
      { time: "20:30", name: "Dinner", items: "2 roti, dal, mixed tarkari, 1 bowl curd. Skip fried snacks and sugary tea.", calories: 500 },
    ],
    notes: `Fill half the plate with vegetables. Keep rice to one small bowl. ${NOTE}`,
  },
  {
    title: "Muscle gain — high protein",
    goal: "BUILD_MUSCLE",
    dailyCalories: 2800, proteinG: 160, carbsG: 360, fatG: 80, waterMl: 3500,
    meals: [
      { time: "7:00", name: "Breakfast", items: "3 eggs omelette, 2 roti or 3 slices brown bread, 1 glass milk, 1 banana", calories: 650 },
      { time: "10:30", name: "Snack", items: "Chiura with peanuts (60 g) and curd", calories: 400 },
      { time: "13:30", name: "Lunch", items: "Full plate rice, dal, 200 g chicken/mutton/fish, saag, achar, salad", calories: 800 },
      { time: "17:00", name: "Before training", items: "2 bananas + peanut butter toast", calories: 350 },
      { time: "19:00", name: "After training", items: "1 scoop whey or 2 glasses milk, boiled chana", calories: 250 },
      { time: "21:00", name: "Dinner", items: "Rice or 3 roti, rajma/chana curry, 150 g paneer or 3 eggs, tarkari", calories: 650 },
    ],
    notes: `Eat every 3–4 hours and sleep 7–8 hours — that's when muscle grows. ${NOTE}`,
  },
  {
    title: "Vegetarian balanced",
    goal: "MAINTAIN",
    dailyCalories: 2200, proteinG: 100, carbsG: 290, fatG: 70, waterMl: 3000,
    meals: [
      { time: "7:30", name: "Breakfast", items: "Oats or dhido with milk, handful of nuts, 1 fruit", calories: 450 },
      { time: "11:00", name: "Snack", items: "Sprouted moong chaat or roasted makai", calories: 200 },
      { time: "13:30", name: "Lunch", items: "Rice, thick dal, gundruk or saag, 100 g paneer or soybean (bhatmas) curry, salad", calories: 700 },
      { time: "17:00", name: "Snack", items: "Curd with fruit or 2 boiled eggs if you eat eggs", calories: 200 },
      { time: "20:30", name: "Dinner", items: "2–3 roti, chana/rajma, seasonal tarkari", calories: 600 },
    ],
    notes: `Combine dal with rice or roti at each main meal for complete protein. ${NOTE}`,
  },
  {
    title: "Healthy start (beginners)",
    goal: "GENERAL_HEALTH",
    dailyCalories: null, proteinG: null, carbsG: null, fatG: null, waterMl: 2500,
    meals: [
      { time: "Morning", name: "Breakfast", items: "Protein with every breakfast: eggs, milk, curd, paneer or chana", calories: null },
      { time: "Midday", name: "Lunch", items: "Half plate vegetables, quarter rice/roti, quarter dal/meat/paneer", calories: null },
      { time: "Evening", name: "Dinner", items: "Same plate rule, a little lighter than lunch, at least 2 hours before bed", calories: null },
    ],
    notes: `Simple rules first: drink water before tea, cut sugary drinks and packet snacks, eat fruit daily. ${NOTE}`,
  },
];
