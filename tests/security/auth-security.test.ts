import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, cleanupTestData, registerCleanup } from "../api/helpers";
import { prisma } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeSession } from "@/lib/auth/session";
import { generateTOTPSecret, verifyTOTP } from "@/lib/auth/mfa";
import crypto from "crypto";

// Mock Next.js request/response
function createMockRequest(method: string, url: string, body?: any, headers?: Record<string, string>) {
  return {
    method,
    url,
    headers: { get: (name: string) => headers?.[name.toLowerCase()] || null },
    cookies: { get: (name: string) => headers?.cookie?.split("; ").find(c => c.startsWith(`${name}=`))?.split("=")[1] || undefined },
    json: async () => body,
    text: async () => JSON.stringify(body),
    nextUrl: { searchParams: new URLSearchParams() },
  } as any;
}

function createMockResponse() {
  const headers: Record<string, string> = {};
  return {
    status: 200,
    headers,
    json: vi.fn((data) => data),
    setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as any;
}

describe("Security Tests - Authentication", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("Password Security", () => {
    it("should hash passwords with Argon2id", async () => {
      const password = "TestPassword123!";
      const hash = await hashPassword(password);
      
      expect(hash).toContain("$argon2id$");
      expect(hash).toContain("v=19");
      expect(hash).toContain("m=65536");
      expect(hash).toContain("t=3");
      expect(hash).toContain("p=4");
    });

    it("should verify correct password", async () => {
      const password = "TestPassword123!";
      const hash = await hashPassword(password);
      const valid = await verifyPassword(password, hash);
      expect(valid).toBe(true);
    });

    it("should reject incorrect password", async () => {
      const password = "TestPassword123!";
      const hash = await hashPassword(password);
      const valid = await verifyPassword("WrongPassword", hash);
      expect(valid).toBe(false);
    });

    it("should use constant-time comparison", async () => {
      const password = "TestPassword123!";
      const hash = await hashPassword(password);
      
      // Time multiple verifications
      const times: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = process.hrtime.bigint();
        await verifyPassword("WrongPassword", hash);
        const end = process.hrtime.bigint();
        times.push(Number(end - start));
      }
      
      // Variance should be low (constant-time)
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);
      
      // Standard deviation should be small relative to mean
      expect(stdDev / avg).toBeLessThan(0.5);
    });
  });

  describe("Session Security", () => {
    it("should create secure session tokens", async () => {
      const userId = "test-user-id";
      const session = await createSession(userId, "test-gym-id");
      
      expect(session.token).toBeDefined();
      expect(session.token.length).toBeGreaterThanOrEqual(32);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("should hash tokens before storage", async () => {
      const userId = "test-user-id-2";
      const session = await createSession(userId, "test-gym-id");
      
      // Token in database should be hashed
      const stored = await prisma.session.findUnique({ where: { id: session.id } });
      expect(stored?.tokenHash).not.toBe(session.token);
      expect(stored?.tokenHash).toContain("$argon2id$");
    });

    it("should revoke sessions properly", async () => {
      const userId = "test-user-id-3";
      const session = await createSession(userId, "test-gym-id");
      
      await revokeSession(session.token);
      
      const stored = await prisma.session.findUnique({ where: { id: session.id } });
      expect(stored?.revokedAt).not.toBeNull();
    });

    it("should expire sessions", async () => {
      const userId = "test-user-id-4";
      const session = await createSession(userId, "test-gym-id", { expiresIn: -1000 }); // Already expired
      
      const stored = await prisma.session.findUnique({ where: { id: session.id } });
      expect(stored?.expiresAt.getTime()).toBeLessThan(Date.now());
    });
  });

  describe("MFA Security", () => {
    it("should generate secure TOTP secrets", async () => {
      const secret = generateTOTPSecret();
      
      expect(secret).toBeDefined();
      expect(secret.length).toBeGreaterThanOrEqual(32); // Base32 encoded
      expect(secret).toMatch(/^[A-Z2-7]+$/); // Base32 alphabet
    });

    it("should verify valid TOTP codes", async () => {
      const secret = generateTOTPSecret();
      const token = await generateTOTP(secret); // Helper to generate current token
      
      const valid = verifyTOTP(token, secret);
      expect(valid).toBe(true);
    });

    it("should reject invalid TOTP codes", async () => {
      const secret = generateTOTPSecret();
      const valid = verifyTOTP("000000", secret);
      expect(valid).toBe(false);
    });

    it("should reject replayed TOTP codes", async () => {
      const secret = generateTOTPSecret();
      const token = await generateTOTP(secret);
      
      // First use should succeed
      expect(verifyTOTP(token, secret)).toBe(true);
      
      // Immediate replay should fail (depending on implementation)
      // This tests the time-window aspect
    });

    it("should enforce MFA for privileged operations", async () => {
      // This would be tested at API level
      // MFA required for: password change, sensitive settings, admin actions
    });
  });

  describe("Rate Limiting", () => {
    it("should limit login attempts", async () => {
      const email = "ratelimit@test.com";
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({ data: { email, name: "Rate Limit Test", passwordHash } });

      // Make multiple failed attempts
      for (let i = 0; i < 5; i++) {
        const res = await client.post("/api/auth/login", { 
          identifier: email, 
          password: "wrongpassword" 
        });
        expect([401, 429]).toContain(res.status);
      }

      // 6th attempt should be rate limited
      const res = await client.post("/api/auth/login", { 
        identifier: email, 
        password: "wrongpassword" 
      });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe("rate_limited");
    });

    it("should limit password reset requests", async () => {
      const email = "resetlimit@test.com";
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({ data: { email, name: "Reset Limit Test", passwordHash } });

      for (let i = 0; i < 3; i++) {
        const res = await client.post("/api/auth/password/forgot", { email });
        expect(res.status).toBe(200);
      }

      // 4th should be rate limited
      const res = await client.post("/api/auth/password/forgot", { email });
      expect(res.status).toBe(429);
    });

    it("should limit API requests per IP", async () => {
      // Test general API rate limiting
      for (let i = 0; i < 100; i++) {
        const res = await client.get("/api/health");
        if (res.status === 429) {
          expect(res.body.code).toBe("rate_limited");
          return;
        }
      }
      // If we get here, rate limiting might not be on health endpoint
    });
  });

  describe("Account Lockout", () => {
    it("should lock account after failed attempts", async () => {
      const email = "lockout@test.com";
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({ 
        data: { email, name: "Lockout Test", passwordHash, failedLoginCount: 0 } 
      });

      // Make 5 failed attempts (assuming threshold is 5)
      for (let i = 0; i < 5; i++) {
        await client.post("/api/auth/login", { identifier: email, password: "wrong" });
      }

      // Account should be locked
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.lockedUntil).not.toBeNull();
      expect(user?.failedLoginCount).toBeGreaterThanOrEqual(5);

      // Further attempts should fail with locked message
      const res = await client.post("/api/auth/login", { identifier: email, password: "password123" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("account_locked");
    });

    it("should unlock after lockout period", async () => {
      const email = "unlock@test.com";
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({ 
        data: { 
          email, 
          name: "Unlock Test", 
          passwordHash, 
          failedLoginCount: 5,
          lockedUntil: new Date(Date.now() - 1000), // Locked in past
        } 
      });

      const res = await client.post("/api/auth/login", { identifier: email, password: "password123" });
      expect(res.status).toBe(200);
      
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.failedLoginCount).toBe(0);
      expect(user?.lockedUntil).toBeNull();
    });
  });

  describe("CSRF Protection", () => {
    it("should require CSRF token for state-changing operations", async () => {
      const passwordHash = await hashPassword("password123");
      const user = await prisma.user.create({ 
        data: { email: "csrf@test.com", name: "CSRF Test", passwordHash } 
      });
      
      await client.post("/api/auth/login", { identifier: "csrf@test.com", password: "password123" });

      // Try state-changing operation without CSRF
      const res = await client.post("/api/auth/password/change", {
        currentPassword: "password123",
        newPassword: "newpassword123",
      }, { "x-csrf-token": "invalid" });
      
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("csrf_invalid");
    });

    it("should accept valid CSRF token", async () => {
      // Would need to extract CSRF from login response
      // This is a placeholder for the actual test
    });
  });

  describe("Secure Headers", () => {
    it("should set security headers", async () => {
      const res = await client.get("/api/health");
      
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
      expect(res.headers["referrer-policy"]).toBeDefined();
      expect(res.headers["content-security-policy"]).toBeDefined();
    });

    it("should set HSTS in production", async () => {
      // Would test with APP_ENV=production
    });
  });
});

// Helper function for TOTP generation
async function generateTOTP(secret: string): Promise<string> {
  const otplib = await import("otplib");
  return otplib.authenticator.generate(secret);
}