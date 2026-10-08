import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { randomToken } from "@/lib/crypto";

// loginUser sets cookies through next/headers; keep them in a jar per simulated browser.
const browser = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (browser.jar.has(name) ? { name, value: browser.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void browser.jar.set(name, value),
    delete: (name: string) => void browser.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { loginUser, loginAdmin } = await import("@/lib/auth/session");

const PASSWORD = "Right-Password-1";
const at = (ip: string) => ({ ip, userAgent: "test" });
const newBrowser = () => (browser.jar = new Map());

async function account() {
  const email = `owner-${randomToken(6).toLowerCase()}@example.test`;
  await prisma.user.create({ data: { name: "Owner", email, passwordHash: await hashPassword(PASSWORD) } });
  return email;
}

async function failFrom(email: string, ip: string, times: number) {
  const codes: string[] = [];
  for (let i = 0; i < times; i++) {
    try {
      await loginUser(email, "wrong-password-9", at(ip));
      codes.push("ok");
    } catch (e) {
      codes.push((e as { code?: string }).code ?? "error");
    }
  }
  return codes;
}

beforeEach(newBrowser);

describe("sign-in throttling can't be used to lock someone out", () => {
  it("wrong passwords from one address block that address, not the account", async () => {
    const email = await account();
    const codes = await failFrom(email, "203.0.113.10", 6);
    expect(codes.at(-1)).toBe("rate_limited");
    await expect(loginUser(email, PASSWORD, at("203.0.113.10"))).rejects.toMatchObject({ code: "rate_limited" });
    // The real owner, elsewhere, still gets in.
    await expect(loginUser(email, PASSWORD, at("198.51.100.20"))).resolves.toMatchObject({ needsMfa: false });
  });

  it("guessing spread across many addresses hits an account-wide ceiling", async () => {
    const email = await account();
    for (let i = 0; i < 60; i++) await failFrom(email, `192.0.2.${i}`, 1);
    await expect(loginUser(email, PASSWORD, at("198.51.100.99"))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("…but a device that has signed in before still gets in", async () => {
    const email = await account();
    await loginUser(email, PASSWORD, at("198.51.100.30")); // this browser now carries a device cookie
    const ownersBrowser = browser.jar;
    newBrowser();
    for (let i = 0; i < 60; i++) await failFrom(email, `192.0.2.${i}`, 1);
    browser.jar = ownersBrowser;
    await expect(loginUser(email, PASSWORD, at("198.51.100.30"))).resolves.toMatchObject({ needsMfa: false });
  });

  it("a device cookie issued for one account doesn't help with another", async () => {
    const mine = await account();
    const theirs = await account();
    await loginUser(mine, PASSWORD, at("198.51.100.40"));
    for (let i = 0; i < 60; i++) await failFrom(theirs, `192.0.2.${i}`, 1);
    await expect(loginUser(theirs, PASSWORD, at("198.51.100.40"))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("failed sign-ins never set a hard account lock", async () => {
    const email = await account();
    await failFrom(email, "203.0.113.50", 5);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).lockedUntil).toBeNull();
  });

  it("platform admins get the same treatment", async () => {
    const email = `admin-${randomToken(6).toLowerCase()}@example.test`;
    await prisma.platformAdmin.create({ data: { email, name: "Admin", role: "SUPER_ADMIN", passwordHash: await hashPassword(PASSWORD), mfaRequired: false } });
    for (let i = 0; i < 6; i++) await loginAdmin(email, "wrong-password-9", at("203.0.113.60")).catch(() => undefined);
    await expect(loginAdmin(email, PASSWORD, at("198.51.100.60"))).resolves.toMatchObject({ needsMfa: false });
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { email } })).lockedUntil).toBeNull();
  });
});
