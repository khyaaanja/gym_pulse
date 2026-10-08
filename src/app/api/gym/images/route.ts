import { gymRoute, readUploadForm } from "@/lib/api";
import { MAX_IMAGE_BYTES, saveImage } from "@/services/files";
import { badRequest } from "@/lib/errors";
import { audit } from "@/lib/audit";

/** Product images for marketplace listings (re-encoded server-side). */
export const POST = gymRoute({ permission: "marketplace.manage", feature: "marketplace", rateLimit: { limit: 60, windowSeconds: 3600 } }, async (ctx, req) => {
  const form = await readUploadForm(req, MAX_IMAGE_BYTES);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Choose an image.");
  const stored = await saveImage(ctx.gym.id, "PRODUCT_IMAGE", Buffer.from(await file.arrayBuffer()), ctx.user.id);
  await audit({ actor: ctx.actor, action: "marketplace.image_uploaded", entityType: "StoredFile", entityId: stored.id, gymId: ctx.gym.id });
  return { fileId: stored.id, url: `/api/files/${stored.id}` };
});
