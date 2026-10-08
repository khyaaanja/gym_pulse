import { userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { mfaQrDataUrl, newMfaSecret } from "@/lib/auth/mfa";
import { badRequest } from "@/lib/errors";

/** Starts enrollment: stores a pending secret (not active until confirmed with a code). */
export const POST = userRoute({ requireMfa: true, allowSetup: true }, async (ctx) => {
  if (ctx.user.mfaEnabled) throw badRequest("Two-step verification is already on.");
  const { secret, secretEnc } = newMfaSecret();
  await prisma.user.update({ where: { id: ctx.user.id }, data: { mfaSecretEnc: secretEnc } });
  return { qr: await mfaQrDataUrl(ctx.user.email ?? ctx.user.phone ?? ctx.user.name, secret), secret };
});
