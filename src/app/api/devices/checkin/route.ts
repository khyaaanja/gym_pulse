import { z } from "zod";
import { parseJson, publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { sha256 } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { checkIn, gymForDevice } from "@/services/attendance";

/**
 * NFC reader / kiosk device endpoint. Authenticated by a per-device API key
 * (`Authorization: Device <key>`), scoped to the device's gym.
 */
export const POST = publicRoute({ rateLimit: { limit: 600, windowSeconds: 60 }, skipOriginCheck: true }, async (_ctx, req) => {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Device ") ? auth.slice(7).trim() : "";
  const device = key ? await gymForDevice(sha256(key)) : null;
  if (!device) throw new AppError(401, "unauthorized", "Unknown device.");
  if (device.gym.status !== "ACTIVE" && device.gym.status !== "TRIAL") throw new AppError(403, "gym_suspended", "Gym unavailable.");
  const { credentialUid } = await parseJson(req, z.object({ credentialUid: z.string().min(2).max(64) }));
  const member = await prisma.member.findFirst({ where: { gymId: device.gymId, credentialUid, archivedAt: null } });
  await prisma.checkInDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  if (!member) throw notFound("Card not registered.");
  const res = await checkIn(device.gym, member.id, device.kind === "NFC_READER" ? "NFC" : "KIOSK", { deviceId: device.id, locationId: device.locationId ?? undefined });
  return { ...res, memberName: member.fullName.split(" ")[0] };
});
