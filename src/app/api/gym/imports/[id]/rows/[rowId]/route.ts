import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { editRow } from "@/services/imports/pipeline";

export const PATCH = gymRoute({ permission: "imports.create" }, async (ctx, req, params) => {
  const { values } = await parseJson(req, z.object({ values: z.record(z.string(), z.string().max(200)) }));
  return editRow(ctx.gym.id, String(params.id), String(params.rowId), values, { ...ctx.actor, id: ctx.user.id });
});
