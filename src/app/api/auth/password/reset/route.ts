import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { sha256 } from "@/lib/crypto";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { securityEvent } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const POST = publicRoute({ rateLimit: { limit: 10, windowSeconds: 900 } }, async (ctx, req) => {
  const { token, password } = await parseJson(req, z.object({ token: z.string().min(20).max(200), password: passwordSchema }));
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== "PASSWORD_RESET" || row.usedAt || row.expiresAt < new Date() || !row.userId) {
    throw badRequest("This reset link has expired or was already used. Request a new one.");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId }, select: { email: true, emailVerifiedAt: true } });
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // The link goes to the email when there is one, so using it proves the address.
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), mustResetPassword: false, failedLoginCount: 0, lockedUntil: null, ...(user.email && !user.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}) } }),
    // Reclaiming an account also drops any sign-in method that isn't tied to the account's own email.
    prisma.oAuthAccount.deleteMany({ where: { userId: row.userId, ...(user.email ? { NOT: { email: user.email } } : {}) } }),
  ]);
  await revokeAllUserSessions(row.userId);
  await securityEvent({ type: "PASSWORD_RESET", actorType: "USER", userId: row.userId, ...ctx.meta });
  return { ok: true };
});
