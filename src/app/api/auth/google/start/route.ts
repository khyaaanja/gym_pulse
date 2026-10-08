import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/api";
import { randomToken, signPayload } from "@/lib/crypto";
import { getUserSession } from "@/lib/auth/session";
import { authorizationUrl, googleConfig, OAUTH_COOKIE, OAUTH_TTL_MS, safeNext } from "@/lib/auth/google";

/**
 * Sends the browser to Google. State, nonce and the PKCE verifier ride in a short-lived signed, httpOnly cookie, so
 * the callback can prove the response belongs to this browser's request. `?link=1` while signed in connects Google
 * to the current account instead of signing in.
 */
export const GET = publicRoute({ rateLimit: { limit: 30, windowSeconds: 900 } }, async (_ctx, req) => {
  const cfg = googleConfig();
  const url = new URL(req.url);
  if (!cfg) return NextResponse.redirect(new URL("/login?error=google_unavailable", url));
  const link = url.searchParams.get("link") === "1" && !!(await getUserSession());
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const next = safeNext(url.searchParams.get("next"));
  const res = NextResponse.redirect(authorizationUrl({ clientId: cfg.clientId, state, nonce, verifier }));
  res.cookies.set(OAUTH_COOKIE, signPayload({ k: "google", s: state, n: nonce, v: verifier, next, link, exp: Date.now() + OAUTH_TTL_MS }), {
    httpOnly: true,
    secure: process.env.APP_ENV === "production" || process.env.APP_URL?.startsWith("https://"),
    // Lax: the cookie must come back on Google's top-level redirect to the callback.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_TTL_MS / 1000,
  });
  return res;
});
