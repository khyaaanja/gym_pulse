import { NextResponse } from "next/server";
import { publicRoute, readUploadForm } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { analyzeRecords, PREVIEW_MAX_FILES } from "@/services/imports/preview";

/**
 * Free records check from the homepage — no account. Files are read in memory and dropped when the response is
 * sent; nothing is stored or logged. Limited per IP, with a platform-wide ceiling since IPs can rotate.
 */
export const POST = publicRoute({ rateLimit: { limit: 12, windowSeconds: 3600 } }, async (_ctx, req) => {
  await rateLimit("records-check:global", 400, 3600);
  const form = await readUploadForm(req, Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024);
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("Choose a file to check.");
  if (files.length > PREVIEW_MAX_FILES) throw badRequest(`Check up to ${PREVIEW_MAX_FILES} files at a time.`);
  const result = await analyzeRecords(await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) }))));
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
});
