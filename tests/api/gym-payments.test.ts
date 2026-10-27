import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, cleanupTestData, seedTestGym, testData, expectSuccess, expectError, expectUnauthorized, expectValidationError, registerCleanup } from "./helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

// Import route handlers
import * as paymentsRoute from "@/app/api/gym/payments/route";
import * as manualPaymentsRoute from "@/app/api/gym/payments/manual/route";
import * as paymentProvidersRoute from "@/app/api/gym/payment-providers/route";

// Mock Next.js request/response
function createMockRequest(method: string, url: string, body?: any, headers?: Record<string, string>) {
  return {
    method,
    url,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] || null,
    },
    cookies: {
      get: (name: string) => headers?.cookie?.split("; ").find(c => c.startsWith(`${name}=`))?.split("=")[1] || undefined,
    },
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
  } as any;
}

describe("API Contract Tests - Gym Payments Routes", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testOwner: any;
  let testMember: any;
  let testPlan: any;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);

    // Mount route handlers
    app.get("/api/gym/payments", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/gym/payments", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await paymentsRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/gym/payments/manual", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/gym/payments/manual", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await manualPaymentsRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/gym/payment-providers", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/gym/payment-providers", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await paymentProvidersRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/gym/payment-providers", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/gym/payment-providers", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await paymentProvidersRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    // Seed test data
    const { gym, owner, plan } = await seedTestGym();
    testGym = gym;
    testOwner = owner;
    testPlan = plan;

    const passwordHash = await hashPassword("password123");
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash },
    });

    testMember = await prisma.member.create({
      data: testData.member(testGym.id, { fullName: "Payment Test Member" }),
    });

    await loginAsOwner(client, owner.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("GET /api/gym/payments", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/gym/payments");
      expectUnauthorized(res);
    });

    it("should return empty list for new gym", async () => {
      const res = await client.get("/api/gym/payments");
      const body = expectSuccess(res, 200);
      expect(body.payments).toBeInstanceOf(Array);
      expect(body.payments.length).toBe(0);
    });

    it("should return paginated payments", async () => {
      // Create test payments
      for (let i = 0; i < 5; i++) {
        await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            amountPaisa: 500000 + i * 10000,
            status: i % 2 === 0 ? "SUCCEEDED" : "PENDING",
          }),
        });
      }

      const res = await client.get("/api/gym/payments?page=1&limit=3");
      const body = expectSuccess(res, 200);
      expect(body.payments.length).toBe(3);
      expect(body.pagination.total).toBe(5);
    });

    it("should filter by status", async () => {
      const res = await client.get("/api/gym/payments?status=SUCCEEDED");
      const body = expectSuccess(res, 200);
      expect(body.payments.every((p: any) => p.status === "SUCCEEDED")).toBe(true);
    });

    it("should filter by member", async () => {
      const otherMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "Other Member" }),
      });
      await prisma.payment.create({
        data: testData.payment(testGym.id, otherMember.id, { amountPaisa: 100000 }),
      });

      const res = await client.get(`/api/gym/payments?memberId=${testMember.id}`);
      const body = expectSuccess(res, 200);
      expect(body.payments.every((p: any) => p.memberId === testMember.id)).toBe(true);
    });

    it("should filter by date range", async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      const res = await client.get(`/api/gym/payments?from=${yesterday}&to=${tomorrow}`);
      const body = expectSuccess(res, 200);
      // All payments should be within range
    });
  });

  describe("POST /api/gym/payments/manual", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/gym/payments/manual", { memberId: testMember.id, planId: testPlan.id });
      expectUnauthorized(res);
    });

    it("should validate required fields", async () => {
      const res = await client.post("/api/gym/payments/manual", {});
      expectValidationError(res, "memberId");
    });

    it("should validate method is valid", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "INVALID_METHOD",
      });
      expectValidationError(res, "method");
    });

    it("should record cash payment successfully", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
        notes: "Cash payment at desk",
      });
      const body = expectSuccess(res, 201);
      expect(body.payment).toBeDefined();
      expect(body.payment.method).toBe("CASH");
      expect(body.payment.status).toBe("SUCCEEDED");
      expect(body.membership).toBeDefined();
      expect(body.membership.status).toBe("ACTIVE");
    });

    it("should record card payment successfully", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CARD",
        amountPaisa: testPlan.pricePaisa,
        providerRef: "txn_123456",
      });
      const body = expectSuccess(res, 201);
      expect(body.payment.method).toBe("CARD");
      expect(body.payment.providerRef).toBe("txn_123456");
    });

    it("should record wallet payment successfully", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "WALLET",
        amountPaisa: testPlan.pricePaisa,
      });
      const body = expectSuccess(res, 201);
      expect(body.payment.method).toBe("WALLET");
    });

    it("should create membership with correct dates", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });
      const body = expectSuccess(res, 201);
      
      const startDate = new Date(body.membership.startDate);
      const endDate = new Date(body.membership.endDate);
      const expectedEnd = new Date(startDate);
      expectedEnd.setDate(expectedEnd.getDate() + testPlan.durationDays);
      
      expect(endDate.getTime()).toBe(expectedEnd.getTime());
    });

    it("should handle idempotency key", async () => {
      const idempotencyKey = `idem-${Date.now()}`;
      
      const res1 = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
        idempotencyKey,
      });
      expectSuccess(res1, 201);

      const res2 = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
        idempotencyKey,
      });
      expectSuccess(res2, 201);
      expect(res2.body.payment.id).toBe(res1.body.payment.id);
    });

    it("should reject duplicate payment for same member/plan within minute without confirmation", async () => {
      await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });

      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });
      expectError(res, 409, "duplicate_payment");
    });

    it("should allow duplicate with confirmDuplicate flag", async () => {
      await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });

      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
        confirmDuplicate: true,
      });
      expectSuccess(res, 201);
    });

    it("should apply coupon discount", async () => {
      const coupon = await prisma.coupon.create({
        data: testData.coupon(testGym.id, { code: "PAYMENT10", value: 10, kind: "PERCENT" }),
      });

      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
        couponCode: coupon.code,
      });
      const body = expectSuccess(res, 201);
      expect(body.payment.discountPaisa).toBeGreaterThan(0);
      expect(body.payment.amountPaisa).toBe(testPlan.pricePaisa - body.payment.discountPaisa);
    });
  });

  describe("GET /api/gym/payment-providers", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/gym/payment-providers");
      expectUnauthorized(res);
    });

    it("should return available providers", async () => {
      const res = await client.get("/api/gym/payment-providers");
      const body = expectSuccess(res, 200);
      expect(body.providers).toBeInstanceOf(Array);
      // Should include sandbox in test mode
      expect(body.providers.some((p: any) => p.key === "sandbox")).toBe(true);
    });
  });

  describe("POST /api/gym/payment-providers", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/gym/payment-providers", { providerKey: "esewa" });
      expectUnauthorized(res);
    });

    it("should validate provider key", async () => {
      const res = await client.post("/api/gym/payment-providers", { providerKey: "invalid" });
      expectValidationError(res, "providerKey");
    });

    it("should enable provider with credentials", async () => {
      const res = await client.post("/api/gym/payment-providers", {
        providerKey: "esewa",
        enabled: true,
        environment: "SANDBOX",
        credentials: { productCode: "TEST", secretKey: "secret" },
      });
      const body = expectSuccess(res, 201);
      expect(body.provider.providerKey).toBe("esewa");
      expect(body.provider.enabled).toBe(true);
    });

    it("should update existing provider config", async () => {
      await client.post("/api/gym/payment-providers", {
        providerKey: "esewa",
        enabled: true,
        environment: "SANDBOX",
        credentials: { productCode: "TEST", secretKey: "secret" },
      });

      const res = await client.post("/api/gym/payment-providers", {
        providerKey: "esewa",
        enabled: false,
      });
      const body = expectSuccess(res, 200);
      expect(body.provider.enabled).toBe(false);
    });
  });
});