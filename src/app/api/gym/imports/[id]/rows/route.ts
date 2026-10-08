import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { notFound } from "@/lib/errors";

export const GET = gymRoute({ permission: "imports.view" }, async (ctx, req, params) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.enum(["ALL", "CLEAN", "NEEDS_REVIEW", "DUPLICATE", "INVALID", "SKIPPED", "IMPORTED", "ISSUES"]).default("ALL"), pageSize: z.coerce.number().int().min(1).max(100).default(50) }));
  const jobId = String(params.id);
  if (!(await ctx.db.importJob.findUnique({ where: { id: jobId }, select: { id: true } }))) throw notFound("Import not found.");
  const where =
    q.status === "ALL" ? { importJobId: jobId } : q.status === "ISSUES"
        ? // Decided duplicates (merge / create new) are settled; only undecided ones need attention.
          { importJobId: jobId, OR: [{ status: { in: ["NEEDS_REVIEW" as const, "INVALID" as const] } }, { status: "DUPLICATE" as const, duplicateAction: null }] } : { importJobId: jobId, status: q.status };
  const [items, total] = await Promise.all([
    ctx.db.importRow.findMany({ where, include: { issues: { select: { field: true, type: true, severity: true, message: true } } }, orderBy: { rowIndex: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.importRow.count({ where }),
  ]);
  return paged(items, total, q.page, q.pageSize);
});
