import { gymRoute, paged, paginationSchema, parseQuery, readUploadForm } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { createImport } from "@/services/imports/pipeline";

export const GET = gymRoute({ permission: "imports.view" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema);
  const [items, total] = await Promise.all([
    ctx.db.importJob.findMany({ include: { file: { select: { originalName: true, kind: true, sizeBytes: true, uploadedById: true, rawDeletedAt: true, scanStatus: true } }, predictionReport: { select: { id: true, confidence: true } } }, orderBy: { startedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.importJob.count(),
  ]);
  return paged(items, total, q.page, q.pageSize);
});

/** Multipart upload. The file is validated by extension, MIME type and magic bytes, then encrypted at rest. */
export const POST = gymRoute({ permission: "imports.create", feature: "file_import", rateLimit: { limit: 20, windowSeconds: 3600 } }, async (ctx, req) => {
  const form = await readUploadForm(req, Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a file to upload.");
  const job = await createImport(ctx.gym, { ...ctx.actor, id: ctx.user.id }, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
  return { jobId: job.id };
});
