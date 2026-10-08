import { z } from "zod";
import { parseJson, userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { securityEvent } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const POST = userRoute({ allowSetup: true }, async (ctx, req) => {
  const body = await parseJson(req, z.object({ current: z.string().min(1), next: passwordSchema }));
  await rateLimit(`pwchange:${ctx.user.id}`, 5, 900);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyPassword(user.passwordHash, body.current))) throw badRequest("Your current password isn't right.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next), passwordChangedAt: new Date(), mustResetPassword: false } });
  await revokeAllUserSessions(user.id, ctx.session.id);
  await securityEvent({ type: "PASSWORD_CHANGED", actorType: "USER", userId: user.id, ...ctx.meta });
  return { ok: true };
});
