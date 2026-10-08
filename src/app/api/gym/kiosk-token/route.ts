import { gymRoute, requestOrigin } from "@/lib/api";
import { kioskToken } from "@/services/attendance";
import { resolveLocation } from "@/services/locations";

export const GET = gymRoute({ permission: "attendance.create", feature: "attendance" }, async (ctx, req) => {
  const locationId = await resolveLocation(ctx.gym.id, req.nextUrl.searchParams.get("locationId"));
  const { token, expiresInSeconds } = kioskToken(ctx.gym, Date.now(), locationId);
  return { url: `${requestOrigin(req)}/checkin/${token}`, expiresInSeconds };
});
