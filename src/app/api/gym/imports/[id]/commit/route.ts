import { gymRoute } from "@/lib/api";
import { requestCommit } from "@/services/imports/pipeline";

export const POST = gymRoute({ permission: "imports.create" }, async (ctx, _req, params) => requestCommit(ctx.gym.id, String(params.id), ctx.actor));
