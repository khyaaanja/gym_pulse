import { prisma } from "@/db/client";
import { badRequest } from "@/lib/errors";
import { putEncrypted } from "./imports/storage";
import { sniff } from "./imports/detect";
import type { StoredFileKind } from "@/generated/prisma/enums";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** File ids arrive from the client: accept only an image this gym uploaded for this purpose. */
export async function assertOwnImage(gymId: string, fileId: string | null | undefined, kind: StoredFileKind) {
  if (!fileId) return;
  const f = await prisma.storedFile.findFirst({ where: { id: fileId, gymId, kind, storageKey: { startsWith: "public/" } }, select: { id: true } });
  if (!f) throw badRequest("Upload the image again.");
}

/**
 * Images are decoded and re-encoded to WebP with sharp: this strips EXIF (incl. GPS) and any
 * payload smuggled in the original file. Only JPEG/PNG input is accepted.
 */
export async function saveImage(gymId: string, kind: StoredFileKind, data: Buffer, uploadedBy: string) {
  if (data.length > MAX_IMAGE_BYTES) throw badRequest("Images can be up to 5 MB.");
  const type = sniff(data);
  if (type !== "jpg" && type !== "png") throw badRequest("Upload a JPG or PNG image.");
  const sharp = (await import("sharp")).default;
  let out: Buffer;
  try {
    out = await sharp(data, { failOn: "error" }).rotate().resize({ width: kind === "LOGO" ? 512 : 1200, height: kind === "LOGO" ? 512 : 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw badRequest("We couldn't read that image.");
  }
  const row = await prisma.storedFile.create({ data: { gymId, kind, mimeType: "image/webp", sizeBytes: out.length, storageKey: "pending", uploadedBy } });
  const key = await putEncrypted("public", gymId, row.id, out);
  return prisma.storedFile.update({ where: { id: row.id }, data: { storageKey: key } });
}
