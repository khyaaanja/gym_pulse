import { createHash } from "node:crypto";
import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { securityEvent } from "@/lib/audit";
import type { RequestMeta } from "./session";

/**
 * "Continue with Google" — OpenID Connect authorization-code flow with PKCE, state and nonce.
 *
 * The ID token comes straight from Google's token endpoint over TLS, authenticated with our client secret, so per
 * OIDC Core §3.1.3.7 its signature need not be re-checked; every claim that matters (iss, aud, exp, nonce,
 * email_verified) still is.
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export const OAUTH_COOKIE = "gp_oauth";
export const OAUTH_TTL_MS = 10 * 60_000;

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const googleConfigured = () => googleConfig() !== null;

export function redirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/auth/google/callback`;
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export { safeNext } from "@/lib/safe-next";

export function authorizationUrl(p: { clientId: string; state: string; nonce: string; verifier: string }) {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

export type GoogleProfile = { sub: string; email: string; name: string };

const fail = (why: string) => new AppError(401, "google_failed", `Google sign-in didn't complete (${why}). Please try again.`);

/** Checks the ID token's claims. Anything unexpected is a failure, never a partial sign-in. */
export function verifyIdTokenClaims(claims: Record<string, unknown>, expect: { clientId: string; nonce: string; nowSeconds?: number }): GoogleProfile {
  const now = expect.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!ISSUERS.has(String(claims.iss))) throw fail("issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.clientId)) throw fail("audience");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw fail("expired");
  if (typeof claims.iat === "number" && claims.iat > now + 300) throw fail("issued in the future");
  if (claims.nonce !== expect.nonce) throw fail("nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw fail("subject");
  if (typeof claims.email !== "string" || claims.email_verified !== true) throw new AppError(403, "google_unverified", "Your Google account's email isn't verified. Verify it with Google, or sign up with email and password.");
  const email = claims.email.trim().toLowerCase();
  const name = (typeof claims.name === "string" && claims.name.trim()) || email.split("@")[0]!;
  return { sub: claims.sub, email, name: name.slice(0, 80) };
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw fail("token");
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw fail("token");
  }
}

export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const cfg = googleConfig();
  if (!cfg) throw fail("not configured");
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw fail("token exchange");
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw fail("no id token");
  return decodeJwtPayload(body.id_token);
}

/**
 * Finds or creates the account for a verified Google identity.
 *  - Already linked (provider + subject) → that account.
 *  - Someone signed in (connecting Google from Account & security) → linked, but only when the Google email is the
 *    account's own email. Linking a different Google account would let whoever briefly held a session keep a way
 *    in that survives a password reset.
 *  - An account that already uses this email is never linked automatically, verified or not: an invite (whose link
 *    the inviter sees) or an online join can create an account for someone else's address. The owner signs in
 *    with their password (or resets it by email) and connects Google from there.
 *  - Otherwise a new account, with the email marked verified.
 */
export async function signInWithGoogle(profile: GoogleProfile, meta: RequestMeta, signedInUserId: string | null = null) {
  const linked = await prisma.oAuthAccount.findUnique({ where: { provider_subject: { provider: "google", subject: profile.sub } }, include: { user: true } });
  let user = linked?.user ?? null;
  let outcome: "returning" | "linked" | "created" = "returning";
  if (linked) {
    if (signedInUserId && linked.userId !== signedInUserId) throw new AppError(409, "link_conflict", "That Google account is already connected to a different GymPulse account.");
    await prisma.oAuthAccount.update({ where: { id: linked.id }, data: { lastUsedAt: new Date(), email: profile.email } });
  } else if (signedInUserId) {
    const target = await prisma.user.findUnique({ where: { id: signedInUserId } });
    if (!target) throw fail("account");
    if (target.email?.toLowerCase() !== profile.email) throw new AppError(409, "link_email_mismatch", "Connect the Google account that uses this account's email address.");
    if (await prisma.oAuthAccount.findFirst({ where: { userId: target.id, provider: "google" } })) throw new AppError(409, "link_conflict", "This GymPulse account is already connected to a different Google account.");
    outcome = "linked";
    await prisma.oAuthAccount.create({ data: { provider: "google", subject: profile.sub, userId: target.id, email: profile.email } });
    // Google just proved this address belongs to the person signed in.
    user = target.emailVerifiedAt ? target : await prisma.user.update({ where: { id: target.id }, data: { emailVerifiedAt: new Date() } });
  } else if (await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })) {
    throw new AppError(409, "link_required", "You already have a GymPulse account with this email. Sign in with your password once (or use Forgot password), then connect Google from Account & security.");
  } else {
    outcome = "created";
    user = await prisma.user.create({ data: { name: profile.name, email: profile.email, emailVerifiedAt: new Date(), oauthAccounts: { create: { provider: "google", subject: profile.sub, email: profile.email } } } });
  }
  if (!user) throw fail("account");
  if (user.disabledAt) {
    await securityEvent({ type: "LOGIN_FAILED", actorType: "USER", userId: user.id, email: profile.email, ...meta, details: { provider: "google", disabled: true } });
    throw new AppError(403, "account_disabled", "This account has been disabled. Contact your gym or GymPulse support.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } });
  await securityEvent({ type: "LOGIN_SUCCESS", actorType: "USER", userId: user.id, email: profile.email, ...meta, details: { provider: "google", outcome } });
  return { user, outcome };
}
