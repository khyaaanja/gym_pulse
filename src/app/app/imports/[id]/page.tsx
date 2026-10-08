import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/page-auth";
import { audit } from "@/lib/audit";
import { TARGET_OPTIONS } from "@/services/imports/mapping";
import { ImportReview } from "@/components/app/import-review";

export const metadata = { title: "Review import" };

export default async function ImportPage({ params }: PageProps<"/app/imports/[id]">) {
  const ctx = await requireStaff("imports.view");
  const { id } = await params;
  const job = await ctx.db.importJob.findUnique({ where: { id }, include: { file: true, mappings: { orderBy: { sourceIndex: "asc" } }, predictionReport: { select: { id: true, confidence: true, lossRangeLow: true, lossRangeHigh: true, rangeLow: true, rangeHigh: true, highRiskCount: true, insufficientReason: true } } } });
  if (!job) notFound();
  const jobIssues = await ctx.db.dataQualityIssue.findMany({ where: { importJobId: job.id, importRowId: null } });
  await audit({ actor: ctx.actor, action: "imports.viewed", entityType: "ImportJob", entityId: job.id, gymId: ctx.gym.id });
  return (
    <ImportReview
      canEdit={ctx.can("imports.create")}
      targetOptions={TARGET_OPTIONS}
      job={{
        id: job.id, status: job.status, recordType: job.recordType, registerMonth: job.registerMonth, fileName: job.file.originalName, kind: job.file.kind, ocrUsed: job.ocrUsed, ocrConfidence: job.ocrConfidence,
        totalRows: job.totalRows, cleanRows: job.cleanRows, reviewRows: job.reviewRows, duplicateRows: job.duplicateRows, invalidRows: job.invalidRows, importedRows: job.importedRows, skippedRows: job.skippedRows,
        qualityScore: job.qualityScore, errorMessage: job.errorMessage, stats: (job.stats ?? {}) as Record<string, unknown>, rawDeleted: !!job.file.rawDeletedAt, rawExpiresAt: job.file.rawExpiresAt.toISOString(), scanStatus: job.file.scanStatus,
        mappings: job.mappings.map((m) => ({ sourceIndex: m.sourceIndex, sourceHeader: m.sourceHeader, targetField: m.targetField, confidence: m.confidence, isManual: m.isManual })),
        jobIssues: jobIssues.map((i) => ({ type: i.type, message: i.message })),
        report: job.predictionReport,
      }}
    />
  );
}
