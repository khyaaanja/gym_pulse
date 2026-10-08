import { publicRoute } from "@/lib/api";
import { handleWebhook } from "@/services/payments/service";

/** Server-to-server payment webhooks. Signature verification happens before the body is trusted. */
export const POST = publicRoute({ rateLimit: { limit: 600, windowSeconds: 60 }, skipOriginCheck: true }, async (_ctx, req, params) => {
  const raw = await req.text();
  if (raw.length > 64 * 1024) return new Response("Payload too large", { status: 413 });
  const res = await handleWebhook(String(params.provider), raw, req.headers);
  return { received: true, duplicate: res.duplicate, status: res.status };
});
