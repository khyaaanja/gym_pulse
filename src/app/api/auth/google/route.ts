import { userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { badRequest } from "@/lib/errors";
import { securityEvent } from "@/lib/audit";

/** Disconnects Google. Refused while it's the only way in, so nobody locks themselves out. */
export const DELETE = userRoute({}, async (ctx) => {
  if (!ctx.user.passwordHash) throw badRequest("Set a password first (sign out and use Forgot password), so you can still sign in without Google.");
  const r = await prisma.oAuthAccount.deleteMany({ where: { userId: ctx.user.id, provider: "google" } });
  if (r.count) await securityEvent({ type: "OAUTH_UNLINKED", actorType: "USER", userId: ctx.user.id, ...ctx.meta, details: { provider: "google" } });
  return { ok: true };
});
