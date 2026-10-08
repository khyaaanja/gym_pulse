import { gymRoute, readUploadForm } from "@/lib/api";
import { MAX_IMAGE_BYTES, saveImage } from "@/services/files";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";

/** Uploads the gym logo (re-encoded server-side; never served as the original bytes). */
export const POST = gymRoute({ permission: "settings.manage", rateLimit: { limit: 30, windowSeconds: 3600 } }, async (ctx, req) => {
  const form = await readUploadForm(req, MAX_IMAGE_BYTES);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Choose an image.");
  const stored = await saveImage(ctx.gym.id, "LOGO", Buffer.from(await file.arrayBuffer()), ctx.user.id);
  await prisma.gym.update({ where: { id: ctx.gym.id }, data: { logoFileId: stored.id } });
  await audit({ actor: ctx.actor, action: "settings.logo_updated", entityType: "StoredFile", entityId: stored.id, gymId: ctx.gym.id });
  return { fileId: stored.id, url: `/api/files/${stored.id}` };
});
