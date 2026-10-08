import { z } from "zod";
import { gymRoute, parseQuery } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { TARGET_OPTIONS } from "@/services/imports/mapping";
import { deleteImportData } from "@/services/imports/pipeline";
import { audit } from "@/lib/audit";

export const GET = gymRoute({ permission: "imports.view" }, async (ctx, _req, params) => {
  const job = await ctx.db.importJob.findUnique({
    where: { id: String(params.id) },
    include: { file: true, mappings: { orderBy: { sourceIndex: "asc" } }, predictionReport: { select: { id: true, confidence: true, estimatedAtRisk: true, rangeLow: true, rangeHigh: true, highRiskCount: true } } },
  });
  if (!job) throw notFound("Import not found.");
  const jobIssues = await ctx.db.dataQualityIssue.findMany({ where: { importJobId: job.id, importRowId: null } });
  await audit({ actor: ctx.actor, action: "imports.viewed", entityType: "ImportJob", entityId: job.id, gymId: ctx.gym.id });
  const { storageKey: _k, sha256: _s, ...file } = job.file;
  return { ...job, file, jobIssues, targetOptions: TARGET_OPTIONS };
});

/** Delete the raw file now, or purge the structured rows too (members already imported are kept). */
export const DELETE = gymRoute({ permission: "imports.create" }, async (ctx, req, params) => {
  const { purge } = parseQuery(req, z.object({ purge: z.enum(["true", "false"]).default("false") }));
  await deleteImportData(ctx.gym.id, String(params.id), ctx.actor, purge === "true");
  return { ok: true };
});
