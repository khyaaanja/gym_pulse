import { gymRoute } from "@/lib/api";
import { reprocessImport } from "@/services/imports/pipeline";

export const POST = gymRoute({ permission: "imports.create" }, async (ctx, _req, params) => {
  await reprocessImport(ctx.gym.id, String(params.id), ctx.actor);
  return { ok: true };
});
