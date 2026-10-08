import { gymRoute } from "@/lib/api";
import { assertWithinLimit } from "@/lib/limits";
import { enqueue } from "@/services/jobs";
import { audit } from "@/lib/audit";

export const GET = gymRoute({ permission: "prediction.view", feature: "churn_prediction" }, async (ctx) => {
  return ctx.db.predictionReport.findMany({ orderBy: { generatedAt: "desc" }, take: 20, select: { id: true, source: true, generatedAt: true, confidence: true, estimatedAtRisk: true, rangeLow: true, rangeHigh: true, modelVersion: true, importJobId: true } });
});

export const POST = gymRoute({ permission: "prediction.view", feature: "churn_prediction", rateLimit: { limit: 10, windowSeconds: 3600 } }, async (ctx) => {
  await assertWithinLimit(ctx.gym.id, "predictionsPerMonth", ctx.gym.timezone);
  await enqueue("prediction.generate", { gymId: ctx.gym.id, source: "MANUAL", createdById: ctx.user.id }, { gymId: ctx.gym.id, priority: 5, idempotencyKey: `prediction.manual:${ctx.gym.id}:${Math.floor(Date.now() / 60_000)}` });
  await audit({ actor: ctx.actor, action: "prediction.requested", entityType: "PredictionReport", gymId: ctx.gym.id });
  return { queued: true };
});
