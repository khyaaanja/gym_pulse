import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { updateMappings } from "@/services/imports/pipeline";

export const PATCH = gymRoute({ permission: "imports.create" }, async (ctx, req, params) => {
  const body = await parseJson(req, z.object({ changes: z.array(z.object({ sourceIndex: z.number().int().min(0), targetField: z.string().max(40) })).max(200).default([]), registerMonth: z.string().nullable().optional() }));
  return updateMappings(ctx.gym.id, String(params.id), body.changes, body.registerMonth, ctx.actor);
});
