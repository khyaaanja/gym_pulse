import { z } from "zod";
import { gymRoute, paginationSchema, parseQuery, paged } from "@/lib/api";
import { notFound } from "@/lib/errors";

export const GET = gymRoute({ permission: "prediction.view", feature: "churn_prediction" }, async (ctx, req, params) => {
  const q = parseQuery(req, paginationSchema.extend({ category: z.enum(["ALL", "CRITICAL", "HIGH", "MODERATE", "LOW"]).default("ALL") }));
  const report = await ctx.db.predictionReport.findUnique({ where: { id: String(params.id) }, include: { factors: { orderBy: { sortOrder: "asc" } }, revenueProjection: true } });
  if (!report) throw notFound();
  const where = { reportId: report.id, ...(q.category === "ALL" ? {} : { category: q.category }) };
  const [items, total] = await Promise.all([
    ctx.db.riskAssessment.findMany({ where, include: { member: { select: { id: true, fullName: true, phone: true, memberCode: true } } }, orderBy: { score: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.riskAssessment.count({ where }),
  ]);
  return { report, assessments: paged(items, total, q.page, q.pageSize) };
});
