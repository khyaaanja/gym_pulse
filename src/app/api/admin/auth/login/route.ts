import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { loginAdmin } from "@/lib/auth/session";

export const POST = publicRoute({ rateLimit: { limit: 20, windowSeconds: 900 } }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }));
  const r = await loginAdmin(b.email, b.password, ctx.meta);
  // MFA first; a pending password reset is picked up by requireAdmin once MFA is done.
  return { ...r, redirect: r.needsMfa ? "/super-admin/login/mfa" : r.needsMfaEnrollment ? "/super-admin/login/mfa?enroll=1" : r.mustResetPassword ? "/super-admin/login/password" : "/super-admin" };
});
