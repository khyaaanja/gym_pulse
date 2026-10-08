import { userRoute } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { notify, wasSent } from "@/services/notifications";

/** Sends a test push to the signed-in user's own devices. */
export const POST = userRoute({}, async (ctx) => {
  await rateLimit(`push-test:${ctx.user.id}`, 5, 600);
  const n = await notify({
    gymId: ctx.session.activeGymId,
    channel: "PUSH",
    category: "SYSTEM",
    userId: ctx.user.id,
    title: "Notifications are on",
    body: "This is how GymPulse alerts will look on this device.",
    link: "/app/notifications",
    essential: true,
  });
  if (!wasSent(n)) throw badRequest(n.error ?? "Couldn't send a test notification.");
  return { ok: true };
});
