import { prisma } from "@/db/client";
import { publicRoute } from "@/lib/api";
import { getAdminSession } from "@/lib/auth/session";
import { mfaQrDataUrl, newMfaSecret } from "@/lib/auth/mfa";
import { AppError, badRequest } from "@/lib/errors";

/** Enrollment for an admin who has signed in with a password but has no second factor yet. */
export const POST = publicRoute({ rateLimit: { limit: 10, windowSeconds: 900 } }, async () => {
  const s = await getAdminSession("partial");
  if (!s) throw new AppError(401, "unauthorized", "Please sign in again.");
  if (s.admin.mfaEnabled) throw badRequest("Two-step verification is already on.");
  const { secret, secretEnc } = newMfaSecret();
  await prisma.platformAdmin.update({ where: { id: s.adminId }, data: { mfaSecretEnc: secretEnc } });
  return { qr: await mfaQrDataUrl(s.admin.email, secret), secret };
});
