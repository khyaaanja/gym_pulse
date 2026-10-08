import { z } from "zod";
import { parseJson, userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { normalizeNepalPhone } from "@/lib/phone";
import { createGymForUser } from "@/services/gyms";
import { rateLimit } from "@/lib/rate-limit";
import { conflict } from "@/lib/errors";

const schema = z.object({
  gymName: z.string().trim().min(2, "Enter your gym's name.").max(80),
  city: z.string().trim().max(60).optional(),
  phone: z.string().trim().optional().transform((v) => (v ? normalizeNepalPhone(v) : null)),
  plan: z.string().trim().regex(/^[a-z0-9-]{2,30}$/).optional(),
});

/** Finishes a Google signup: creates the gym around the signed-in account and makes it the active gym. */
export const POST = userRoute({}, async (ctx, req) => {
  await rateLimit(`signup:user:${ctx.user.id}`, 5, 3600);
  const { plan, ...body } = await parseJson(req, schema);
  // Refuse existing owners before spending the platform-wide signup budget (the service re-checks under a lock).
  if (await prisma.staffMember.findFirst({ where: { userId: ctx.user.id, role: "OWNER" }, select: { id: true } })) throw conflict("You already own a gym on GymPulse. Contact support to add another.");
  await rateLimit("signup:global", 30, 3600);
  const { gym } = await createGymForUser(ctx.user.id, { ...body, planKey: plan });
  await prisma.session.update({ where: { id: ctx.session.id }, data: { activeGymId: gym.id } });
  return { ok: true, redirect: "/app/onboarding" };
});
