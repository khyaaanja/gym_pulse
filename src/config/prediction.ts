import { prisma } from "@/db/client";
import type { PredictionConfig } from "@/generated/prisma/client";

export const MODEL_VERSION = "risk-engine-v1.0";

export { DEFAULT_WEIGHTS, DEFAULT_LABELS, type RiskWeights } from "./prediction-defaults";
import { DEFAULT_WEIGHTS, DEFAULT_LABELS, type RiskWeights } from "./prediction-defaults";

export type ResolvedPredictionConfig = Omit<PredictionConfig, "id" | "gymId" | "weights" | "labels" | "confidenceRules" | "createdAt" | "updatedAt" | "updatedById"> & {
  weights: RiskWeights;
  labels: typeof DEFAULT_LABELS;
};

const FIELDS = [
  "inactivityThresholdDays",
  "attentionAfterDays",
  "analysisWindowDays",
  "minAttendanceRecords",
  "minMembers",
  "minHistoryDays",
  "forecastHorizonDays",
  "lostAfterExpiryDays",
  "moderateThreshold",
  "highThreshold",
  "criticalThreshold",
  "nonExpiringChurnShare",
  "protectedRevenueMonths",
] as const;

export const BUILTIN_CONFIG: ResolvedPredictionConfig = {
  inactivityThresholdDays: 10,
  attentionAfterDays: 6,
  analysisWindowDays: 180,
  minAttendanceRecords: 30,
  minMembers: 20,
  minHistoryDays: 60,
  forecastHorizonDays: 30,
  lostAfterExpiryDays: 14,
  moderateThreshold: 30,
  highThreshold: 50,
  criticalThreshold: 75,
  nonExpiringChurnShare: 0.3,
  protectedRevenueMonths: 6,
  weights: DEFAULT_WEIGHTS,
  labels: DEFAULT_LABELS,
};

/** Platform default row (gymId null) overlaid by the gym's row, if any. */
export async function predictionConfigFor(gymId: string | null): Promise<ResolvedPredictionConfig> {
  const rows = await prisma.predictionConfig.findMany({
    where: { OR: [{ gymId: null }, ...(gymId ? [{ gymId }] : [])] },
  });
  const platform = rows.find((r) => r.gymId === null);
  const gym = rows.find((r) => r.gymId === gymId && gymId !== null);
  const out: ResolvedPredictionConfig = { ...BUILTIN_CONFIG, weights: { ...DEFAULT_WEIGHTS }, labels: { ...DEFAULT_LABELS } };
  for (const src of [platform, gym]) {
    if (!src) continue;
    for (const f of FIELDS) (out as Record<string, unknown>)[f] = src[f];
    if (src.weights && typeof src.weights === "object") Object.assign(out.weights, src.weights);
    if (src.labels && typeof src.labels === "object") Object.assign(out.labels, src.labels);
  }
  return out;
}
