import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { changeAdminPassword, getAdminSession } from "@/lib/auth/session";
import { passwordSchema } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";

/**
 * Admin password change: replaces a temporary password (required before the console opens) or any time after.
 * Accepts a partial session so a forced reset can be completed; changeAdminPassword still requires MFA to be done.
 */
export const POST = publicRoute({ rateLimit: { limit: 20, windowSeconds: 900 } }, async (ctx, req) => {
  const s = await getAdminSession("partial");
  if (!s) throw new AppError(401, "unauthorized", "Please sign in again.");
  const b = await parseJson(req, z.object({ current: z.string().min(1).max(200), next: passwordSchema }));
  await changeAdminPassword(s, b.current, b.next, ctx.meta);
  await audit({ actor: { type: "PLATFORM_ADMIN", id: s.adminId, name: s.admin.name, role: s.admin.role, ...ctx.meta }, action: "security.admin_password_changed", entityType: "PlatformAdmin", entityId: s.adminId });
  return { ok: true, redirect: "/super-admin" };
});
