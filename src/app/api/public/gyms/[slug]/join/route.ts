import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { badRequest, notFound } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeNepalPhone } from "@/lib/phone";
import { passwordSchema } from "@/lib/auth/password";
import { createUserSession, getUserSession } from "@/lib/auth/session";
import { joinGymOnline, publicGym } from "@/services/growth";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  password: passwordSchema.optional().or(z.literal("")),
  planId: z.string().max(40).optional().or(z.literal("")),
  ref: z.string().max(20).optional().or(z.literal("")),
  promo: z.string().max(40).optional().or(z.literal("")),
  // Honeypot: hidden from people, filled in by form-spamming bots.
  website: z.string().max(200).optional(),
});

/** Join a gym from its public page: creates (or uses the signed-in) account and a member record, then on to payment. */
export const POST = publicRoute({ rateLimit: { limit: 10, windowSeconds: 3600 } }, async (ctx, req, params) => {
  const gym = await publicGym(String(params.slug));
  if (!gym) throw notFound("This gym page isn't available.");
  const body = await parseJson(req, schema);
  if (body.website) throw badRequest("Please try again.");
  const phone = body.phone ? normalizeNepalPhone(body.phone) : null;
  if (body.phone && !phone) throw badRequest("Enter a valid Nepal mobile number (e.g. 98XXXXXXXX).", [{ path: "phone", message: "Enter a valid Nepal mobile number." }]);
  // Per gym as well as per address, so rotating IPs can't flood one gym with fake members. Counted only for
  // well-formed requests, so junk can't use up the gym's allowance.
  await rateLimit(`join:gym:${gym.id}`, 60, 3600);
  const session = await getUserSession();
  const r = await joinGymOnline(gym, { name: body.name, email: body.email || null, phone, password: body.password || null, planId: body.planId || null, ref: body.ref || null, promo: body.promo || null }, session?.userId ?? null, ctx.meta);
  if (session) await prisma.session.update({ where: { id: session.id }, data: { activeGymId: gym.id } });
  else await createUserSession({ id: r.userId }, ctx.meta, true, gym.id);
  return { ok: true, redirect: r.redirect };
});
