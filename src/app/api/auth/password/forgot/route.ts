import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import { notify } from "@/services/notifications";
import { normalizeNepalPhone } from "@/lib/phone";
import { securityEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

/** Always answers the same way so it can't be used to discover which accounts exist. */
export const POST = publicRoute({ rateLimit: { limit: 5, windowSeconds: 900 } }, async (ctx, req) => {
  const { identifier } = await parseJson(req, z.object({ identifier: z.string().min(3).max(200) }));
  const id = identifier.trim().toLowerCase();
  // Per-account limit, so rotating IPs can't flood one person's inbox/phone with reset messages.
  await rateLimit(`forgot:id:${sha256(id)}`, 3, 3600);
  const phone = normalizeNepalPhone(id);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: id }, ...(phone ? [{ phone }] : [])], disabledAt: null } });
  if (user) {
    const token = randomToken();
    await prisma.authToken.create({ data: { tokenHash: sha256(token), purpose: "PASSWORD_RESET", userId: user.id, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    const link = `${process.env.APP_URL}/reset-password?token=${token}`;
    await notify({ gymId: null, userId: user.id, channel: user.email ? "EMAIL" : "SMS", category: "SECURITY", template: "PASSWORD_RESET", vars: { link }, essential: true });
    await securityEvent({ type: "PASSWORD_RESET_REQUESTED", actorType: "USER", userId: user.id, ...ctx.meta });
  }
  return { ok: true, message: "If an account exists for that email or phone, we've sent a reset link." };
});
