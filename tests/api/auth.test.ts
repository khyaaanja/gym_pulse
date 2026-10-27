import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, cleanupTestData, seedTestGym, testData, expectSuccess, expectError, expectUnauthorized, expectValidationError, registerCleanup } from "./helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

// Import the actual route handlers
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as signupGymRoute from "@/app/api/auth/signup/gym/route";
import * as forgotRoute from "@/app/api/auth/password/forgot/route";
import * as resetRoute from "@/app/api/auth/password/reset/route";
import * as changeRoute from "@/app/api/auth/password/change/route";
import * as mfaSetupRoute from "@/app/api/auth/mfa/setup/route";
import * as mfaEnableRoute from "@/app/api/auth/mfa/enable/route";
import * as mfaVerifyRoute from "@/app/api/auth/mfa/verify/route";
import * as googleStartRoute from "@/app/api/auth/google/start/route";
import * as googleCallbackRoute from "@/app/api/auth/google/callback/route";
import * as inviteRoute from "@/app/api/auth/invite/[token]/route";
import * as switchGymRoute from "@/app/api/auth/switch-gym/route";

// Mock the Next.js request/response
function createMockRequest(method: string, url: string, body?: any, headers?: Record<string, string>) {
  return {
    method,
    url,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] || null,
      set: vi.fn(),
      delete: vi.fn(),
    },
    cookies: {
      get: (name: string) => headers?.cookie?.split("; ").find(c => c.startsWith(`${name}=`))?.split("=")[1] || undefined,
      set: vi.fn(),
      delete: vi.fn(),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
    formData: async () => {
      const form = new FormData();
      if (body) Object.entries(body).forEach(([k, v]) => form.append(k, String(v)));
      return form;
    },
  } as any;
}

function createMockResponse() {
  const headers: Record<string, string> = {};
  const cookies: Record<string, { value: string; options?: any }> = {};
  
  return {
    status: 200,
    headers,
    cookies,
    json: vi.fn((data) => data),
    text: vi.fn((data) => data),
    setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
    getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
    cookie: vi.fn((name: string, value: string, options?: any) => { cookies[name] = { value, options }; }),
    clearCookie: vi.fn((name: string) => { delete cookies[name]; }),
  } as any;
}

describe("API Contract Tests - Auth Routes", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    
    // Mount route handlers
    app.post("/api/auth/login", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/login", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await loginRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/logout", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/logout", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await logoutRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/auth/me", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/auth/me", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await meRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/signup", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/signup", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await signupRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/signup/gym", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/signup/gym", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await signupGymRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/password/forgot", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/password/forgot", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await forgotRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/password/reset", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/password/reset", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await resetRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/password/change", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/password/change", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await changeRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/mfa/setup", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/mfa/setup", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await mfaSetupRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/mfa/enable", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/mfa/enable", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await mfaEnableRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/mfa/verify", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/mfa/verify", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await mfaVerifyRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/auth/google/start", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/auth/google/start", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await googleStartRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/auth/google/callback", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/auth/google/callback", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await googleCallbackRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/auth/switch-gym", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/auth/switch-gym", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await switchGymRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    registerCleanup(cleanupTestData);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("POST /api/auth/login", () => {
    it("should reject missing credentials", async () => {
      const res = await client.post("/api/auth/login", {});
      expectValidationError(res, "identifier");
    });

    it("should reject invalid email format", async () => {
      const res = await client.post("/api/auth/login", { identifier: "not-an-email", password: "password123" });
      expectValidationError(res, "identifier");
    });

    it("should reject short password", async () => {
      const res = await client.post("/api/auth/login", { identifier: "test@test.com", password: "123" });
      expectValidationError(res, "password");
    });

    it("should return 401 for non-existent user", async () => {
      const res = await client.post("/api/auth/login", { identifier: "nonexistent@test.com", password: "password123" });
      expectUnauthorized(res);
    });

    it("should return 401 for wrong password", async () => {
      // Create a test user
      const passwordHash = await hashPassword("correctpassword");
      await prisma.user.create({
        data: {
          email: "testuser@test.com",
          name: "Test User",
          passwordHash,
        },
      });

      const res = await client.post("/api/auth/login", { identifier: "testuser@test.com", password: "wrongpassword" });
      expectUnauthorized(res);
    });

    it("should login successfully with correct credentials", async () => {
      const passwordHash = await hashPassword("correctpassword");
      const user = await prisma.user.create({
        data: {
          email: "logintest@test.com",
          name: "Login Test",
          passwordHash,
        },
      });

      const res = await client.post("/api/auth/login", { identifier: "logintest@test.com", password: "correctpassword" });
      const body = expectSuccess(res, 200);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe("logintest@test.com");
      expect(body.user.id).toBe(user.id);
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("should handle MFA required user", async () => {
      const passwordHash = await hashPassword("password123");
      const user = await prisma.user.create({
        data: {
          email: "mfa@test.com",
          name: "MFA User",
          passwordHash,
          mfaEnabled: true,
          mfaSecretEnc: "encrypted-secret",
        },
      });

      const res = await client.post("/api/auth/login", { identifier: "mfa@test.com", password: "password123" });
      expectSuccess(res, 200);
      expect(res.body.mfaRequired).toBe(true);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should logout successfully", async () => {
      // First login
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({
        data: {
          email: "logout@test.com",
          name: "Logout Test",
          passwordHash,
        },
      });

      await loginAsOwner(client, "logout@test.com", "password123");

      const res = await client.post("/api/auth/logout");
      expectSuccess(res, 200);
      expect(res.body.success).toBe(true);
    });

    it("should handle logout without session gracefully", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/auth/logout");
      expectSuccess(res, 200);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return 401 when not authenticated", async () => {
      const res = await client.get("/api/auth/me");
      expectUnauthorized(res);
    });

    it("should return current user when authenticated", async () => {
      const passwordHash = await hashPassword("password123");
      const user = await prisma.user.create({
        data: {
          email: "metest@test.com",
          name: "Me Test",
          passwordHash,
        },
      });

      await loginAsOwner(client, "metest@test.com", "password123");

      const res = await client.get("/api/auth/me");
      const body = expectSuccess(res, 200);
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe(user.id);
      expect(body.user.email).toBe("metest@test.com");
    });
  });

  describe("POST /api/auth/signup", () => {
    it("should reject missing fields", async () => {
      const res = await client.post("/api/auth/signup", {});
      expectValidationError(res);
    });

    it("should reject invalid email", async () => {
      const res = await client.post("/api/auth/signup", { email: "invalid", password: "password123", name: "Test" });
      expectValidationError(res, "email");
    });

    it("should reject short password", async () => {
      const res = await client.post("/api/auth/signup", { email: "test@test.com", password: "123", name: "Test" });
      expectValidationError(res, "password");
    });

    it("should reject duplicate email", async () => {
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({
        data: {
          email: "duplicate@test.com",
          name: "Existing",
          passwordHash,
        },
      });

      const res = await client.post("/api/auth/signup", { email: "duplicate@test.com", password: "password123", name: "Test" });
      expectError(res, 409, "email_exists");
    });

    it("should create new user successfully", async () => {
      const res = await client.post("/api/auth/signup", { 
        email: "newuser@test.com", 
        password: "password123", 
        name: "New User" 
      });
      const body = expectSuccess(res, 201);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe("newuser@test.com");
      expect(res.headers["set-cookie"]).toBeDefined();
    });
  });

  describe("POST /api/auth/signup/gym", () => {
    it("should reject missing gym fields", async () => {
      const res = await client.post("/api/auth/signup/gym", {});
      expectValidationError(res);
    });

    it("should reject invalid gym slug", async () => {
      const res = await client.post("/api/auth/signup/gym", { 
        gymName: "Test Gym", 
        slug: "Invalid Slug!", 
        email: "owner@test.com", 
        password: "password123", 
        name: "Owner" 
      });
      expectValidationError(res, "slug");
    });

    it("should create gym and owner successfully", async () => {
      const res = await client.post("/api/auth/signup/gym", { 
        gymName: "New Gym", 
        slug: "new-gym", 
        email: "gymowner@test.com", 
        password: "password123", 
        name: "Gym Owner" 
      });
      const body = expectSuccess(res, 201);
      expect(body.gym).toBeDefined();
      expect(body.gym.name).toBe("New Gym");
      expect(body.gym.slug).toBe("new-gym");
      expect(body.owner).toBeDefined();
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("should reject duplicate gym slug", async () => {
      await client.post("/api/auth/signup/gym", { 
        gymName: "Gym 1", 
        slug: "duplicate-slug", 
        email: "owner1@test.com", 
        password: "password123", 
        name: "Owner 1" 
      });

      const res = await client.post("/api/auth/signup/gym", { 
        gymName: "Gym 2", 
        slug: "duplicate-slug", 
        email: "owner2@test.com", 
        password: "password123", 
        name: "Owner 2" 
      });
      expectError(res, 409, "slug_exists");
    });
  });

  describe("POST /api/auth/password/forgot", () => {
    it("should accept valid email", async () => {
      const passwordHash = await hashPassword("password123");
      await prisma.user.create({
        data: {
          email: "forgot@test.com",
          name: "Forgot Test",
          passwordHash,
        },
      });

      const res = await client.post("/api/auth/password/forgot", { email: "forgot@test.com" });
      expectSuccess(res, 200);
      expect(res.body.message).toContain("reset");
    });

    it("should return success even for non-existent email (security)", async () => {
      const res = await client.post("/api/auth/password/forgot", { email: "nonexistent@test.com" });
      expectSuccess(res, 200);
    });

    it("should reject invalid email format", async () => {
      const res = await client.post("/api/auth/password/forgot", { email: "invalid" });
      expectValidationError(res, "email");
    });
  });

  describe("POST /api/auth/password/reset", () => {
    it("should reject missing token", async () => {
      const res = await client.post("/api/auth/password/reset", { password: "newpassword123" });
      expectValidationError(res, "token");
    });

    it("should reject short password", async () => {
      const res = await client.post("/api/auth/password/reset", { token: "valid-token", password: "123" });
      expectValidationError(res, "password");
    });

    it("should reject invalid/expired token", async () => {
      const res = await client.post("/api/auth/password/reset", { token: "invalid-token", password: "newpassword123" });
      expectError(res, 400, "invalid_token");
    });
  });

  describe("POST /api/auth/password/change", () => {
    it("should require authentication", async () => {
      const res = await client.post("/api/auth/password/change", { currentPassword: "old", newPassword: "newpassword123" });
      expectUnauthorized(res);
    });

    it("should reject wrong current password", async () => {
      const passwordHash = await hashPassword("correctpassword");
      await prisma.user.create({
        data: {
          email: "changepass@test.com",
          name: "Change Pass",
          passwordHash,
        },
      });

      await loginAsOwner(client, "changepass@test.com", "correctpassword");

      const res = await client.post("/api/auth/password/change", { currentPassword: "wrongpassword", newPassword: "newpassword123" });
      expectError(res, 401, "invalid_current_password");
    });

    it("should change password successfully", async () => {
      const passwordHash = await hashPassword("oldpassword");
      await prisma.user.create({
        data: {
          email: "changepass2@test.com",
          name: "Change Pass 2",
          passwordHash,
        },
      });

      await loginAsOwner(client, "changepass2@test.com", "oldpassword");

      const res = await client.post("/api/auth/password/change", { currentPassword: "oldpassword", newPassword: "newpassword123" });
      expectSuccess(res, 200);
    });
  });

  describe("MFA Routes", () => {
    describe("POST /api/auth/mfa/setup", () => {
      it("should require authentication", async () => {
        const res = await client.post("/api/auth/mfa/setup");
        expectUnauthorized(res);
      });

      it("should return MFA setup data", async () => {
        const passwordHash = await hashPassword("password123");
        await prisma.user.create({
          data: {
            email: "mfasetup@test.com",
            name: "MFA Setup",
            passwordHash,
          },
        });

        await loginAsOwner(client, "mfasetup@test.com", "password123");

        const res = await client.post("/api/auth/mfa/setup");
        const body = expectSuccess(res, 200);
        expect(body.secret).toBeDefined();
        expect(body.qrCode).toBeDefined();
        expect(body.backupCodes).toBeInstanceOf(Array);
      });
    });

    describe("POST /api/auth/mfa/enable", () => {
      it("should require authentication", async () => {
        const res = await client.post("/api/auth/mfa/enable", { token: "123456" });
        expectUnauthorized(res);
      });

      it("should reject invalid token", async () => {
        const passwordHash = await hashPassword("password123");
        await prisma.user.create({
          data: {
            email: "mfaenable@test.com",
            name: "MFA Enable",
            passwordHash,
          },
        });

        await loginAsOwner(client, "mfaenable@test.com", "password123");

        const res = await client.post("/api/auth/mfa/enable", { token: "000000" });
        expectError(res, 400, "invalid_token");
      });
    });

    describe("POST /api/auth/mfa/verify", () => {
      it("should require authentication", async () => {
        const res = await client.post("/api/auth/mfa/verify", { token: "123456" });
        expectUnauthorized(res);
      });

      it("should verify valid token", async () => {
        const passwordHash = await hashPassword("password123");
        const user = await prisma.user.create({
          data: {
            email: "mfaverify@test.com",
            name: "MFA Verify",
            passwordHash,
            mfaEnabled: true,
            mfaSecretEnc: "encrypted-secret",
          },
        });

        await loginAsOwner(client, "mfaverify@test.com", "password123");

        // Mock TOTP verification
        vi.spyOn(await import("@/lib/auth/mfa"), "verifyTOTP").mockResolvedValue(true);

        const res = await client.post("/api/auth/mfa/verify", { token: "123456" });
        expectSuccess(res, 200);
      });
    });
  });

  describe("OAuth Routes", () => {
    describe("GET /api/auth/google/start", () => {
      it("should return OAuth URL", async () => {
        const res = await client.get("/api/auth/google/start");
        expectSuccess(res, 200);
        expect(res.body.url).toBeDefined();
        expect(res.body.url).toContain("accounts.google.com");
      });

      it("should include gym slug in state when provided", async () => {
        const res = await client.get("/api/auth/google/start?gymSlug=test-gym");
        expectSuccess(res, 200);
        expect(res.body.url).toContain("test-gym");
      });
    });

    describe("GET /api/auth/google/callback", () => {
      it("should reject missing code", async () => {
        const res = await client.get("/api/auth/google/callback");
        expectError(res, 400, "missing_code");
      });

      it("should handle OAuth error", async () => {
        const res = await client.get("/api/auth/google/callback?error=access_denied");
        expectError(res, 400, "oauth_denied");
      });
    });
  });

  describe("POST /api/auth/switch-gym", () => {
    it("should require authentication", async () => {
      const res = await client.post("/api/auth/switch-gym", { gymSlug: "test-gym" });
      expectUnauthorized(res);
    });

    it("should switch gym successfully", async () => {
      const { gym, owner } = await seedTestGym();
      
      const passwordHash = await hashPassword("password123");
      await prisma.user.update({
        where: { id: owner.id },
        data: { passwordHash },
      });

      await loginAsOwner(client, owner.email!, "password123");

      const res = await client.post("/api/auth/switch-gym", { gymSlug: gym.slug });
      expectSuccess(res, 200);
      expect(res.body.activeGymId).toBe(gym.id);
    });

    it("should reject non-member gym", async () => {
      const passwordHash = await hashPassword("password123");
      const user = await prisma.user.create({
        data: { email: "outsider@test.com", name: "Outsider", passwordHash },
      });

      await loginAsOwner(client, "outsider@test.com", "password123");

      const { gym } = await seedTestGym();

      const res = await client.post("/api/auth/switch-gym", { gymSlug: gym.slug });
      expectError(res, 403, "not_member");
    });
  });
});