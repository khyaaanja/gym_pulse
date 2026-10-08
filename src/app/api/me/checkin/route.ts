import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { badRequest, forbidden } from "@/lib/errors";
import { gymSettings } from "@/config/gym-settings";
import { checkIn, kioskTokenLocation, verifyKioskToken } from "@/services/attendance";
import { resolveLocation } from "@/services/locations";

/** Member scans the front-desk kiosk QR with their phone. */
export const POST = memberRoute({ feature: "attendance" }, async (ctx, req) => {
  const { token } = await parseJson(req, z.object({ token: z.string().min(10).max(500) }));
  if (!gymSettings(ctx.gym.settings).attendance.allowSelfQr) throw forbidden("Self check-in is turned off at this gym. Please check in at the front desk.");
  if (!verifyKioskToken(ctx.gym, token)) throw badRequest("This QR code has expired. Scan the code on the screen again.");
  // A branch that closed after the code was shown falls back to the main branch rather than failing the visit.
  const locationId = (await resolveLocation(ctx.gym.id, kioskTokenLocation(token)).catch(() => resolveLocation(ctx.gym.id))) ?? undefined;
  return checkIn(ctx.gym, ctx.member.id, "QR", { locationId });
});
