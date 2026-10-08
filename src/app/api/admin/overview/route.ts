import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { platformOverview, rangeFor } from "@/services/analytics";

export const GET = adminRoute({ permission: "analytics.view" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"), from: z.string().optional(), to: z.string().optional() }));
  return platformOverview(rangeFor(q.range, "Asia/Kathmandu", q));
});
