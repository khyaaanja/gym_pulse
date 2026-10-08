import { z } from "zod";
import { gymRoute, paged, paginationSchema, parseQuery } from "@/lib/api";
import { pulseList } from "@/services/pulse";

export const GET = gymRoute({ permission: "members.view" }, async (ctx, req) => {
  const q = parseQuery(req, paginationSchema.extend({ filter: z.enum(["AT_RISK", "ATTENTION", "LOST", "ALL"]).default("AT_RISK") }));
  const { items, total } = await pulseList(ctx.gym, { filter: q.filter, page: q.page, pageSize: q.pageSize, trainerId: ctx.staff.role === "TRAINER" ? ctx.staff.id : undefined });
  return paged(items, total, q.page, q.pageSize);
});
