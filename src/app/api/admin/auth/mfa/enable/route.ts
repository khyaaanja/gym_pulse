import { z } from "zod";
import { prisma } from "@/db/client";
import { parseJson, publicRoute } from "@/lib/api";
import { getAdminSession } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/mfa";
import { audit } from "@/lib/audit";
import { AppError, badRequest } from "@/lib/errors";

export const POST = publicRoute({ rateLimit: { limit: 10, windowSeconds: 900 } }, async (ctx, req) => {
  const s = await getAdminSession("partial");
  if (!s) throw new AppError(401, "unauthorized", "Please sign in again.");
  const { code } = await parseJson(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: s.adminId } });
  if (!(await verifyTotp(admin.mfaSecretEnc, code))) throw badRequest("That code isn't right.");
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaEnabled: true } });
  await prisma.adminSession.update({ where: { id: s.id }, data: { mfaVerifiedAt: new Date() } });
  await audit({ actor: { type: "PLATFORM_ADMIN", id: admin.id, name: admin.name, role: admin.role, ...ctx.meta }, action: "security.admin_mfa_enabled", entityType: "PlatformAdmin", entityId: admin.id });
  return { ok: true, redirect: "/super-admin" };
});
