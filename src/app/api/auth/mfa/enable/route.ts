import { z } from "zod";
import { parseJson, userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { verifyTotp } from "@/lib/auth/mfa";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const POST = userRoute({ requireMfa: true, allowSetup: true }, async (ctx, req) => {
  const { code } = await parseJson(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyTotp(user.mfaSecretEnc, code))) throw badRequest("That code isn't right. Try the latest code in your app.");
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await prisma.session.update({ where: { id: ctx.session.id }, data: { mfaVerifiedAt: new Date() } });
  await audit({ actor: ctx.actor, action: "security.mfa_enabled", entityType: "User", entityId: user.id });
  return { ok: true };
});
