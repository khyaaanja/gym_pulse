import { adminRoute } from "@/lib/api";
import { prisma } from "@/db/client";

/** Import metadata across gyms. Row contents are deliberately not exposed to platform staff. */
export const GET = adminRoute({ permission: "imports.view" }, async () => {
  const jobs = await prisma.importJob.findMany({ include: { gym: { select: { name: true } }, file: { select: { originalName: true, kind: true, sizeBytes: true, scanStatus: true, rawDeletedAt: true, rawExpiresAt: true } } }, orderBy: { startedAt: "desc" }, take: 200 });
  return jobs.map((j) => ({ id: j.id, gym: j.gym.name, gymId: j.gymId, file: j.file, status: j.status, recordType: j.recordType, totalRows: j.totalRows, importedRows: j.importedRows, qualityScore: j.qualityScore, ocrUsed: j.ocrUsed, ocrConfidence: j.ocrConfidence, errorMessage: j.errorMessage, startedAt: j.startedAt, completedAt: j.completedAt }));
});
