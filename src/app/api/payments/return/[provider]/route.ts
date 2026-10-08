import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/api";
import { handleProviderReturn } from "@/services/payments/service";
import { log } from "@/lib/logger";

/** Browser lands here after eSewa/Khalti. We verify with the provider server-side before showing a result. */
export const GET = publicRoute({ rateLimit: { limit: 60, windowSeconds: 300 } }, async (_ctx, req, params) => {
  const url = new URL(req.url);
  const base = process.env.APP_URL ?? url.origin;
  try {
    const res = await handleProviderReturn(String(params.provider), url.searchParams);
    const p = res.payment;
    if (res.status === "SUCCEEDED" || p?.status === "SUCCEEDED") return NextResponse.redirect(`${base}/app/receipts/${p!.id}`, 303);
    if (res.status === "PENDING") return NextResponse.redirect(`${base}/app/renew?payment=pending`, 303);
    return NextResponse.redirect(`${base}/app/renew?payment=failed`, 303);
  } catch (err) {
    log.warn("payment.return_failed", { err, provider: params.provider });
    return NextResponse.redirect(`${base}/app/renew?payment=failed`, 303);
  }
});
