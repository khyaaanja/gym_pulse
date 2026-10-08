import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { createUserSession } from "@/lib/auth/session";
import { passwordSchema } from "@/lib/auth/password";
import { normalizeNepalPhone } from "@/lib/phone";
import { createGymWithOwner } from "@/services/gyms";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  gymName: z.string().trim().min(2, "Enter your gym's name.").max(80),
  city: z.string().trim().max(60).optional(),
  ownerName: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email."),
  phone: z.string().trim().optional().transform((v) => (v ? normalizeNepalPhone(v) : null)),
  password: passwordSchema,
  plan: z.string().trim().regex(/^[a-z0-9-]{2,30}$/).optional(),
});

export const POST = publicRoute({ rateLimit: { limit: 5, windowSeconds: 3600 } }, async (ctx, req) => {
  // Platform-wide circuit breaker: the per-IP limit alone can be sidestepped by rotating addresses.
  await rateLimit("signup:global", 30, 3600);
  const { plan, ...body } = await parseJson(req, schema);
  const { gym, user } = await createGymWithOwner({ ...body, planKey: plan });
  await createUserSession(user, ctx.meta, true, gym.id);
  return { ok: true, redirect: "/app/onboarding" };
});
