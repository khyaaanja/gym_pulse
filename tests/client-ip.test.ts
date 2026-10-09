import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { POST as forgotPassword } from "@/app/api/auth/password/forgot/route";
import { GET as inviteInfo } from "@/app/api/auth/invite/[token]/route";

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("client IP", () => {
  afterEach(() => delete process.env.TRUSTED_PROXY_HOPS);

  it("reads the entry the nearest trusted proxy appended, ignoring anything the client sent before it", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(h("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(h("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("walks back one entry per trusted proxy", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
  });

  it("returns null without a forwarded address", () => {
    expect(clientIp(h())).toBeNull();
  });

  it("with no proxy (0) ignores the header, which the client controls entirely", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientIp(h("6.6.6.6"))).toBeNull();
    expect(clientIp(h("6.6.6.6, 7.7.7.7"))).toBeNull();
  });
});

describe("production proxy configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });
  const prodEnv = async (hops: string | undefined) => {
    vi.resetModules();
    process.env = { ...saved, APP_ENV: "production", APP_URL: "https://app.example.test", EMAIL_TRANSPORT: "none", ALLOW_ADMIN_WITHOUT_MFA: "false", ENABLE_TEST_GATEWAY: "false" };
    if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = hops;
    const { env } = await import("@/config/env");
    return () => env();
  };

  it("refuses to start when TRUSTED_PROXY_HOPS is left to its default", async () => {
    expect(await prodEnv(undefined)).toThrow(/TRUSTED_PROXY_HOPS explicitly/);
    expect(await prodEnv("")).toThrow(/TRUSTED_PROXY_HOPS explicitly/);
  });

  it("refuses to start without a proxy (0)", async () => {
    expect(await prodEnv("0")).toThrow(/reverse proxy/);
  });

  it("starts with an explicit proxy count", async () => {
    expect((await prodEnv("1"))().TRUSTED_PROXY_HOPS).toBe(1);
    expect((await prodEnv("2"))().TRUSTED_PROXY_HOPS).toBe(2);
  });
});

const post = (path: string, body: unknown, xff: string) =>
  new NextRequest(`http://localhost:3000${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": xff, origin: "http://localhost:3000" } });
const get = (path: string, xff: string) => new NextRequest(`http://localhost:3000${path}`, { headers: { "x-forwarded-for": xff } });

describe("limits that don't depend on the IP", () => {
  it("forgot-password is limited per account, whatever IP the requests claim", async () => {
    const identifier = `nobody-${Date.now()}@example.test`;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await forgotPassword(post("/api/auth/password/forgot", { identifier }, `198.51.100.${i}`))).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.at(-1)).toBe(429);
  });

  it("an invite link is limited per link, whatever IP the requests claim", async () => {
    const token = `no-such-invite-${Date.now()}-padding`;
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await inviteInfo(get(`/api/auth/invite/${token}`, `198.51.100.${i}`), { params: Promise.resolve({ token }) })).status);
    expect(codes[0]).toBe(404);
    expect(codes.at(-1)).toBe(429);
  });
});
