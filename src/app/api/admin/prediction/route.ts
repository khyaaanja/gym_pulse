import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { BUILTIN_CONFIG, DEFAULT_WEIGHTS, MODEL_VERSION } from "@/config/prediction";
import { modelQuality } from "@/services/risk/run";

export const GET = adminRoute({ permission: "prediction.manage" }, async () => {
  const [config, quality, versions, recent] = await Promise.all([
    prisma.predictionConfig.findFirst({ where: { gymId: null } }),
    modelQuality(MODEL_VERSION),
    prisma.riskAssessment.groupBy({ by: ["modelVersion"], _count: true }),
    prisma.predictionReport.findMany({ orderBy: { generatedAt: "desc" }, take: 30, include: { gym: { select: { name: true } } } }),
  ]);
  return { modelVersion: MODEL_VERSION, config: config ?? BUILTIN_CONFIG, defaultWeights: DEFAULT_WEIGHTS, quality, versions, recent: recent.map((r) => ({ id: r.id, gym: r.gym.name, source: r.source, generatedAt: r.generatedAt, confidence: r.confidence, estimatedAtRisk: r.estimatedAtRisk, rangeLow: r.rangeLow, rangeHigh: r.rangeHigh, modelVersion: r.modelVersion, calibrated: r.calibrated })) };
});

const int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);
const schema = z.object({
  inactivityThresholdDays: int(3, 90), attentionAfterDays: int(1, 60), analysisWindowDays: int(30, 730), minAttendanceRecords: int(1, 100_000), minMembers: int(1, 10_000),
  minHistoryDays: int(7, 730), forecastHorizonDays: int(7, 180), lostAfterExpiryDays: int(0, 180), moderateThreshold: int(1, 99), highThreshold: int(1, 99), criticalThreshold: int(1, 100),
  nonExpiringChurnShare: z.number().min(0).max(1), protectedRevenueMonths: int(1, 36),
  weights: z.object({ inactivity: int(0, 100), decline: int(0, 100), expiry: int(0, 100), gap: int(0, 100), frequency: int(0, 100), renewalHistory: int(0, 100) }),
  labels: z.object({ LOW: z.string().max(30), MODERATE: z.string().max(30), HIGH: z.string().max(30), CRITICAL: z.string().max(30) }),
}).refine((c) => c.moderateThreshold < c.highThreshold && c.highThreshold < c.criticalThreshold, { message: "Thresholds must increase: moderate < high < critical." })
  .refine((c) => c.attentionAfterDays < c.inactivityThresholdDays, { message: "'Attention' must start before 'At Risk'." })
  .refine((c) => Object.values(c.weights).some((w) => w > 0), { message: "At least one weight must be above zero." });

/** Changing the rules is audited. The model version is stored on every assessment for reproducibility. */
export const PUT = adminRoute({ permission: "prediction.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const before = await prisma.predictionConfig.findFirst({ where: { gymId: null } });
  const after = before
    ? await prisma.predictionConfig.update({ where: { id: before.id }, data: { ...b, updatedById: ctx.admin.id } })
    : await prisma.predictionConfig.create({ data: { ...b, updatedById: ctx.admin.id } });
  await audit({ actor: ctx.actor, action: "prediction.config_changed", entityType: "PredictionConfig", entityId: after.id, before, after });
  return after;
});
