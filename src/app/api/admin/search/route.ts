import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { adminSearch } from "@/services/search";

export const GET = adminRoute({ permission: "gyms.view" }, async (_ctx, req) => {
  const { q } = parseQuery(req, z.object({ q: z.string().max(100).default("") }));
  return { hits: await adminSearch(q) };
});
