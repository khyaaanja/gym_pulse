import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { verifyUserMfa } from "@/lib/auth/session";

export const POST = publicRoute({ rateLimit: { limit: 30, windowSeconds: 900 } }, async (ctx, req) => {
  const { code } = await parseJson(req, z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }));
  await verifyUserMfa(code, ctx.meta);
  return { ok: true, redirect: "/app" };
});
