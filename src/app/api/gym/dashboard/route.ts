import { z } from "zod";
import { gymRoute, parseQuery } from "@/lib/api";
import { gymDashboard, rangeFor } from "@/services/analytics";

export const GET = gymRoute({ permission: "reports.view" }, async (ctx, req) => {
  const q = parseQuery(req, z.object({ range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"), from: z.string().optional(), to: z.string().optional() }));
  return gymDashboard(ctx.gym, rangeFor(q.range, ctx.gym.timezone, q));
});
