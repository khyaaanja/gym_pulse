import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/api";
import { safeEqual, verifyPayload } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { createUserSession, getUserSession } from "@/lib/auth/session";
import { exchangeCode, googleConfig, OAUTH_COOKIE, signInWithGoogle, verifyIdTokenClaims } from "@/lib/auth/google";

type Pending = { k?: string; s?: string; n?: string; v?: string; next?: string | null; link?: boolean; exp?: number };

/** Google sends the browser back here. Every failure lands on the sign-in page with a reason, never a half sign-in. */
export const GET = publicRoute({ rateLimit: { limit: 30, windowSeconds: 900 } }, async (ctx, req) => {
  const url = new URL(req.url);
  const back = (path: string) => NextResponse.redirect(new URL(path, url));
  const jar = await cookies();
  const pending = verifyPayload<Pending>(jar.get(OAUTH_COOKIE)?.value ?? "");
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  const cfg = googleConfig();
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  // A failed "Sign up with Google" goes back to the signup page, a failed sign-in to the sign-in page.
  const entry = pending?.next?.startsWith("/signup/") ? "/signup" : "/login";
  if (!cfg) return back(`${entry}?error=google_unavailable`);
  if (url.searchParams.get("error")) return back(`${entry}?error=google_cancelled`);
  if (!pending || pending.k !== "google" || !pending.s || !pending.n || !pending.v || !code || (pending.exp ?? 0) < Date.now() || !safeEqual(pending.s, state)) {
    return back(`${entry}?error=google_expired`);
  }
  try {
    const profile = verifyIdTokenClaims(await exchangeCode(code, pending.v), { clientId: cfg.clientId, nonce: pending.n });
    const session = pending.link ? await getUserSession() : null;
    const { user } = await signInWithGoogle(profile, ctx.meta, session?.userId ?? null);
    if (session) return back(pending.next ?? "/app/security?google=connected");
    await createUserSession(user, ctx.meta, !user.mfaEnabled);
    if (user.mfaEnabled) return back("/login/mfa");
    return back(pending.next ?? "/app");
  } catch (err) {
    const reason = err instanceof AppError ? err.code : "google_failed";
    if (!(err instanceof AppError)) log.error("google.callback_failed", { err });
    // A failed "Connect Google" goes back to the Security page; a failed sign-in or signup to where it started.
    return back(`${pending.link ? "/app/security" : entry}?error=${encodeURIComponent(reason)}`);
  }
});
