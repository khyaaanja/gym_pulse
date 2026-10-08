import { z } from "zod";
import { gymRoute, parseQuery } from "@/lib/api";
import { gymSearch } from "@/services/search";

export const GET = gymRoute({ permission: "members.view", rateLimit: { limit: 120, windowSeconds: 60 } }, async (ctx, req) => {
  const { q } = parseQuery(req, z.object({ q: z.string().max(100).default("") }));
  if (ctx.staff.role === "TRAINER") return { hits: [] };
  return { hits: await gymSearch(ctx.gym.id, q, { canPayments: ctx.can("payments.view"), canImports: ctx.can("imports.view") }) };
});
