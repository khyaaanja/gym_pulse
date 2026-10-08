import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { conflict } from "@/lib/errors";

export const GET = adminRoute({ permission: "admins.manage" }, async () =>
  prisma.platformAdmin.findMany({ select: { id: true, email: true, name: true, role: true, mfaEnabled: true, mfaRequired: true, disabledAt: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
);

export const POST = adminRoute({ permission: "admins.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ email: z.string().email(), name: z.string().trim().min(2).max(80), role: z.enum(["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"]), temporaryPassword: passwordSchema }));
  if (await prisma.platformAdmin.findUnique({ where: { email: b.email.toLowerCase() } })) throw conflict("An admin with that email exists.");
  const a = await prisma.platformAdmin.create({ data: { email: b.email.toLowerCase(), name: b.name, role: b.role, passwordHash: await hashPassword(b.temporaryPassword), mustResetPassword: true, mfaRequired: true } });
  await audit({ actor: ctx.actor, action: "admins.created", entityType: "PlatformAdmin", entityId: a.id, after: { email: a.email, role: a.role } });
  return { id: a.id };
});
