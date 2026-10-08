import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { verifyAdminMfa } from "@/lib/auth/session";

export const POST = publicRoute({ rateLimit: { limit: 20, windowSeconds: 900 } }, async (ctx, req) => {
  const { code } = await parseJson(req, z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }));
  await verifyAdminMfa(code, ctx.meta);
  return { ok: true, redirect: "/super-admin" };
});
