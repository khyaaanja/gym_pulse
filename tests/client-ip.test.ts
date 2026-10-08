import { afterEach, describe, expect, it } from "vitest";
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
