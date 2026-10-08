import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { loginUser } from "@/lib/auth/session";

const schema = z.object({ identifier: z.string().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = publicRoute({ rateLimit: { limit: 60, windowSeconds: 900 } }, async (ctx, req) => {
  const body = await parseJson(req, schema);
  const res = await loginUser(body.identifier, body.password, ctx.meta);
  const redirect = res.needsMfa ? "/login/mfa" : res.needsMfaEnrollment ? "/app/security?enroll=1" : res.mustResetPassword ? "/app/security?reset=1" : "/app";
  return { ...res, redirect };
});
