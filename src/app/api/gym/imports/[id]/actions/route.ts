import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { applyRowAction } from "@/services/imports/pipeline";

export const POST = gymRoute({ permission: "imports.create" }, async (ctx, req, params) => {
  const body = await parseJson(req, z.object({ rowIds: z.array(z.string()).min(1).max(5000), action: z.enum(["MERGE", "SKIP", "CREATE_NEW", "ACCEPT", "EXCLUDE", "RESTORE"]) }));
  return applyRowAction(ctx.gym.id, String(params.id), body.rowIds, body.action, ctx.actor);
});
