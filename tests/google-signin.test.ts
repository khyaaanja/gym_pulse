import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { randomToken } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth/password";
import { authorizationUrl, decodeJwtPayload, exchangeCode, pkceChallenge, safeNext, signInWithGoogle, verifyIdTokenClaims } from "@/lib/auth/google";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const CLIENT = "client-123.apps.googleusercontent.com";
const now = 1_800_000_000;
const claims = (over: Record<string, unknown> = {}) => ({ iss: "https://accounts.google.com", aud: CLIENT, exp: now + 600, iat: now, nonce: "n1", sub: "g-1", email: "Person@Example.test", email_verified: true, name: "Person One", ...over });
const profile = (tag: string) => ({ sub: `sub-${tag}-${randomToken(4)}`, email: `${tag}-${randomToken(5)}@example.test`.toLowerCase(), name: "Google Person" });

describe("Google ID token checks", () => {
  it("accepts a valid token and normalises the email", () => {
    expect(verifyIdTokenClaims(claims(), { clientId: CLIENT, nonce: "n1", nowSeconds: now })).toEqual({ sub: "g-1", email: "person@example.test", name: "Person One" });
  });

  it.each([
    ["another issuer", { iss: "https://evil.example" }],
    ["another app's token", { aud: "someone-else" }],
    ["an expired token", { exp: now - 3600 }],
    ["a replayed nonce", { nonce: "other" }],
    ["no subject", { sub: "" }],
    ["an unverified email", { email_verified: false }],
    ["email_verified as a string", { email_verified: "true" }],
  ])("refuses %s", (_label, over) => {
    expect(() => verifyIdTokenClaims(claims(over), { clientId: CLIENT, nonce: "n1", nowSeconds: now })).toThrow();
  });

  it("decodes the payload and exchanges the code with PKCE", async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const payload = Buffer.from(JSON.stringify(claims())).toString("base64url");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id_token: `h.${payload}.s` }), { status: 200 }));
    const out = await exchangeCode("the-code", "the-verifier", fetchImpl as unknown as typeof fetch);
    expect(out.sub).toBe("g-1");
    const sent = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.get("code_verifier")).toBe("the-verifier");
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(() => decodeJwtPayload("garbage")).toThrow();
    const failing = vi.fn(async () => new Response("no", { status: 400 }));
    await expect(exchangeCode("c", "v", failing as unknown as typeof fetch)).rejects.toThrow();
  });

  it("builds the authorization URL with S256 PKCE and only keeps same-site next paths", () => {
    const url = new URL(authorizationUrl({ clientId: CLIENT, state: "s", nonce: "n", verifier: "v" }));
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("v"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(safeNext("/g/my-gym/join?plan=1")).toBe("/g/my-gym/join?plan=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "", null]) expect(safeNext(bad)).toBeNull();
  });
});

describe("signing in with Google", () => {
  it("creates a verified, passwordless account the first time and reuses it after", async () => {
    const p = profile("new");
    const first = await signInWithGoogle(p, meta);
    expect(first.outcome).toBe("created");
    expect(first.user.passwordHash).toBeNull();
    expect(first.user.emailVerifiedAt).not.toBeNull();
    const again = await signInWithGoogle(p, meta);
    expect(again.outcome).toBe("returning");
    expect(again.user.id).toBe(first.user.id);
  });

  it("never auto-links an existing account by email, even a 'verified' one (an invite marks it verified)", async () => {
    const p = profile("verified");
    // e.g. an attacker opened a gym, invited this address, and accepted the invite link themselves.
    const planted = await prisma.user.create({ data: { name: "Planted", email: p.email, emailVerifiedAt: new Date(), passwordHash: await hashPassword("Some-Password-1") } });
    await expect(signInWithGoogle(p, meta)).rejects.toMatchObject({ code: "link_required" });
    expect(await prisma.oAuthAccount.count({ where: { userId: planted.id } })).toBe(0);
  });

  it("refuses to auto-link an account that never proved it owns the email (pre-hijack)", async () => {
    const p = profile("unverified");
    const squatter = await prisma.user.create({ data: { name: "Squatter", email: p.email, passwordHash: await hashPassword("Squatter-Pass-1") } });
    await expect(signInWithGoogle(p, meta)).rejects.toMatchObject({ code: "link_required" });
    expect(await prisma.oAuthAccount.count({ where: { userId: squatter.id } })).toBe(0);
  });

  it("connects Google to the signed-in account only when it's the account's own email", async () => {
    const p = profile("connect");
    const me = await prisma.user.create({ data: { name: "Me", email: p.email, passwordHash: await hashPassword("My-Password-123") } });
    const r = await signInWithGoogle(p, meta, me.id);
    expect(r.user.id).toBe(me.id);
    expect(r.user.emailVerifiedAt).not.toBeNull();
    // Someone holding a session to another person's account can't plant their own Google on it.
    const victim = await prisma.user.create({ data: { name: "Victim", email: `victim-${randomToken(5)}@example.test`.toLowerCase(), passwordHash: await hashPassword("Victim-Pass-123") } });
    await expect(signInWithGoogle(profile("attacker"), meta, victim.id)).rejects.toMatchObject({ code: "link_email_mismatch" });
    expect(await prisma.oAuthAccount.count({ where: { userId: victim.id } })).toBe(0);
    const other = await prisma.user.create({ data: { name: "Other", email: `other-${randomToken(5)}@example.test`.toLowerCase() } });
    await expect(signInWithGoogle(p, meta, other.id)).rejects.toMatchObject({ code: "link_conflict" });
  });

  it("refuses a disabled account", async () => {
    const p = profile("disabled");
    const { user } = await signInWithGoogle(p, meta);
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    await expect(signInWithGoogle(p, meta)).rejects.toMatchObject({ code: "account_disabled" });
  });
});

describe("reclaiming an account with Forgot password", () => {
  it("drops a Google link that isn't the account's own email, and marks the email verified", async () => {
    const { NextRequest } = await import("next/server");
    const { sha256 } = await import("@/lib/crypto");
    const { POST: reset } = await import("@/app/api/auth/password/reset/route");
    const owner = await prisma.user.create({ data: { name: "Owner", email: `owner-${randomToken(5)}@example.test`.toLowerCase(), passwordHash: await hashPassword("Owner-Pass-123") } });
    await prisma.oAuthAccount.create({ data: { provider: "google", subject: `planted-${randomToken(4)}`, userId: owner.id, email: "attacker@example.test" } });
    const token = randomToken();
    await prisma.authToken.create({ data: { tokenHash: sha256(token), purpose: "PASSWORD_RESET", userId: owner.id, expiresAt: new Date(Date.now() + 600_000) } });
    const res = await reset(new NextRequest("http://localhost:3000/api/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password: "Brand-New-Pass-1" }), headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "10.77.0.1" } }));
    expect(res.status).toBe(200);
    expect(await prisma.oAuthAccount.count({ where: { userId: owner.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).emailVerifiedAt).not.toBeNull();
  });
});

describe("finishing a Google signup with a gym", () => {
  it("creates a trial gym owned by the signed-in account, once", async () => {
    const { createGymForUser } = await import("@/services/gyms");
    const { user } = await signInWithGoogle(profile("owner"), meta);
    const { gym } = await createGymForUser(user.id, { gymName: "Google Barbell Club", city: "Pokhara" });
    expect(gym.status).toBe("TRIAL");
    expect(gym.email).toBe(user.email);
    const seat = await prisma.staffMember.findFirst({ where: { gymId: gym.id, userId: user.id } });
    expect(seat?.role).toBe("OWNER");
    expect(await prisma.location.count({ where: { gymId: gym.id, isPrimary: true } })).toBe(1);
    // No password was set along the way, and a second gym is refused.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBeNull();
    await expect(createGymForUser(user.id, { gymName: "Second Gym" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.staffMember.count({ where: { userId: user.id, role: "OWNER" } })).toBe(1);
  });

  it("allows only one gym when requests race", async () => {
    const { createGymForUser } = await import("@/services/gyms");
    const { user } = await signInWithGoogle(profile("race"), meta);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => createGymForUser(user.id, { gymName: `Race Gym ${i}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    expect(await prisma.staffMember.count({ where: { userId: user.id, role: "OWNER" } })).toBe(1);
  });

  it("refuses a plan that isn't on the pricing page", async () => {
    const { createGymForUser } = await import("@/services/gyms");
    const { user } = await signInWithGoogle(profile("plan"), meta);
    await expect(createGymForUser(user.id, { gymName: "Hidden Plan Gym", planKey: "no-such-plan" })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.staffMember.count({ where: { userId: user.id } })).toBe(0);
  });
});
