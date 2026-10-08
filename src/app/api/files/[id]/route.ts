import { publicRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { notFound } from "@/lib/errors";
import { getPlain } from "@/services/imports/storage";

/** Serves re-encoded logos/product images only. Import files are never reachable here. */
export const GET = publicRoute({ rateLimit: { limit: 600, windowSeconds: 60 } }, async (_ctx, _req, params) => {
  const f = await prisma.storedFile.findUnique({ where: { id: String(params.id) } });
  if (!f || !f.storageKey.startsWith("public/")) throw notFound();
  const data = await getPlain(f.storageKey);
  return new Response(new Uint8Array(data), { headers: { "content-type": f.mimeType, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff" } });
});
