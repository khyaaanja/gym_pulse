import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeNepalPhone } from "@/lib/phone";
import { publicGym, submitLead } from "@/services/growth";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  goal: z.string().trim().max(80).optional().or(z.literal("")),
  message: z.string().trim().max(500).optional().or(z.literal("")),
  preferredVisitOn: z.string().max(10).optional().or(z.literal("")),
  ref: z.string().max(20).optional().or(z.literal("")),
  promo: z.string().max(40).optional().or(z.literal("")),
  website: z.string().max(200).optional(),
});

/** "Book a free trial" / enquiry from the public gym page. Always the same answer, whether new or repeat. */
export const POST = publicRoute({ rateLimit: { limit: 5, windowSeconds: 3600 } }, async (_ctx, req, params) => {
  const gym = await publicGym(String(params.slug));
  if (!gym) throw notFound("This gym page isn't available.");
  const body = await parseJson(req, schema);
  const message = { ok: true, message: `Thanks! ${gym.name} will contact you soon.` };
  // Bots get the same success reply so they don't learn to skip the trap.
  if (body.website) return message;
  const phone = body.phone ? normalizeNepalPhone(body.phone) : null;
  if (body.phone && !phone) throw badRequest("Enter a valid Nepal mobile number (e.g. 98XXXXXXXX).", [{ path: "phone", message: "Enter a valid Nepal mobile number." }]);
  await rateLimit(`lead:gym:${gym.id}`, 200, 86_400);
  await submitLead(gym, { name: body.name, phone, email: body.email || null, goal: body.goal || null, message: body.message || null, preferredVisitOn: body.preferredVisitOn || null, ref: body.ref || null, promo: body.promo || null });
  return message;
});
