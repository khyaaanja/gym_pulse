import { describe, expect, it } from "vitest";
import { bmi, bmiBand, dailyTargets, macroCalories } from "@/lib/nutrition";
import { parseMeals } from "@/components/ui/transforms";
import { mealsToText, mealSchema } from "@/services/diet";

describe("daily targets", () => {
  it("matches Mifflin-St Jeor for a known case", () => {
    // 70 kg, 175 cm, 30-year-old man: 10*70 + 6.25*175 - 5*30 + 5 = 1648.75
    const t = dailyTargets({ sex: "male", ageYears: 30, weightKg: 70, heightCm: 175, activity: "moderate", goal: "MAINTAIN" });
    expect(t.bmr).toBe(1649);
    expect(t.maintenance).toBe(Math.round(1648.75 * 1.55));
    expect(t.calories).toBe(2560);
  });

  it("macros add up to the calorie target (within rounding) and fat loss is below maintenance", () => {
    const t = dailyTargets({ sex: "female", ageYears: 28, weightKg: 62, heightCm: 158, activity: "light", goal: "LOSE_FAT" });
    expect(t.calories).toBeLessThan(t.maintenance);
    expect(Math.abs(macroCalories(t.proteinG, t.carbsG, t.fatG) - t.calories)).toBeLessThanOrEqual(12);
    expect(t.proteinG).toBe(124);
  });

  it("never suggests a crash diet", () => {
    const t = dailyTargets({ sex: "female", ageYears: 70, weightKg: 40, heightCm: 140, activity: "sedentary", goal: "LOSE_FAT" });
    expect(t.calories).toBe(1200);
  });

  it("refuses impossible stats instead of returning nonsense", () => {
    expect(() => dailyTargets({ sex: "male", ageYears: 5, weightKg: 70, heightCm: 175, activity: "moderate", goal: "MAINTAIN" })).toThrow(RangeError);
  });

  it("uses Asian BMI cut-offs", () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmiBand(24)).toBe("Overweight");
    expect(bmiBand(22)).toBe("Healthy");
  });
});

describe("meal text round-trip", () => {
  it("parses `time | meal | items | kcal` and writes it back", () => {
    const meals = parseMeals("8:00 | Breakfast | 2 eggs, roti | 300\nLunch | Dal bhat\nJust fruit\n\n7 PM | Dinner | Roti | dal | 450 kcal");
    expect(meals).toEqual([
      { time: "8:00", name: "Breakfast", items: "2 eggs, roti", calories: 300 },
      { time: "", name: "Lunch", items: "Dal bhat", calories: null },
      { time: "", name: "Meal", items: "Just fruit", calories: null },
      { time: "7 PM", name: "Dinner", items: "Roti | dal", calories: 450 },
    ]);
    for (const m of meals) expect(mealSchema.safeParse(m).success).toBe(true);
    expect(parseMeals(mealsToText(meals.map((m) => ({ ...m, calories: m.calories ?? undefined }))))).toEqual(meals);
  });
});
