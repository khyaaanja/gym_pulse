import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { createUserSession, getUserSession } from "@/lib/auth/session";
import { passwordSchema } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { acceptInvite, inviteByToken } from "@/services/invites";
import { notFound } from "@/lib/errors";
import { maskPhone } from "@/lib/phone";

/** Per-link limit: holds even when the caller rotates IP addresses. */
const perLink = (token: string, limit: number) => rateLimit(`invite:${sha256(token)}`, limit, 900);

export const GET = publicRoute({ rateLimit: { limit: 30, windowSeconds: 900 } }, async (_ctx, _req, params) => {
  await perLink(String(params.token), 20);
  const invite = await inviteByToken(String(params.token));
  if (!invite) throw notFound("This invitation has expired or was already used.");
  return { gymName: invite.gym.name, role: invite.role, email: invite.email, phone: maskPhone(invite.phone) };
});

/**
 * New people send a name and password to create their account. People who already have an account accept while
 * signed in to it (no body needed) — this endpoint never checks an existing account's password.
 */
export const POST = publicRoute({ rateLimit: { limit: 10, windowSeconds: 900 } }, async (ctx, req, params) => {
  await perLink(String(params.token), 20);
  const body = await parseJson(req, z.object({ name: z.string().trim().min(2).max(80).optional(), password: passwordSchema.optional() }));
  const session = await getUserSession();
  const { userId, gymId } = await acceptInvite(String(params.token), body, session?.userId ?? null);
  // A signed-in account that just joined switches to the new gym; a new account gets its first session.
  if (session?.userId === userId) await prisma.session.update({ where: { id: session.id }, data: { activeGymId: gymId } });
  else await createUserSession({ id: userId }, ctx.meta, true, gymId);
  return { ok: true, redirect: "/app" };
});
