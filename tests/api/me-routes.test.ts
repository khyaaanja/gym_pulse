import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsMember, cleanupTestData, seedTestGym, testData, expectSuccess, expectError, expectUnauthorized, expectValidationError, registerCleanup } from "./helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

// Import route handlers
import * as meRoute from "@/app/api/auth/me/route";
import * as checkinRoute from "@/app/api/me/checkin/route";
import * as renewRoute from "@/app/api/me/renew/route";
import * as ordersRoute from "@/app/api/me/orders/route";
import * as couponRoute from "@/app/api/me/coupon/route";
import * as passRoute from "@/app/api/me/pass/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as notificationsPrefsRoute from "@/app/api/notifications/preferences/route";

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

describe("API Contract Tests - Member Routes (/api/me/*)", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testOwner: any;
  let testMember: any;
  let testMemberUser: any;
  let testPlan: any;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);

    // Mount route handlers
    app.get("/api/me/checkin", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/me/checkin", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await checkinRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/me/checkin", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/me/checkin", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await checkinRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/me/renew", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/me/renew", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await renewRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/me/renew", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/me/renew", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await renewRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/me/orders", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/me/orders", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await ordersRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/me/coupon", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/me/coupon", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await couponRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/me/pass", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/me/pass", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await passRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/notifications", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/notifications", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await notificationsRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/notifications/preferences", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/notifications/preferences", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await notificationsPrefsRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.patch("/api/notifications/preferences", async (req, res) => {
      const mockReq = createMockRequest("PATCH", "/api/notifications/preferences", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await notificationsPrefsRoute.PATCH(mockReq, mockRes);
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

    // Create member with user account
    testMemberUser = await prisma.user.create({
      data: { email: `member-${Date.now()}@test.com`, name: "Test Member", passwordHash },
    });

    testMember = await prisma.member.create({
      data: testData.member(testGym.id, { 
        fullName: "Test Member", 
        userId: testMemberUser.id,
        email: testMemberUser.email,
      }),
    });

    // Create active membership
    await prisma.membership.create({
      data: {
        gymId: testGym.id,
        memberId: testMember.id,
        planId: testPlan.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86400000),
        pricePaisa: testPlan.pricePaisa,
        status: "ACTIVE",
      },
    });

    await loginAsMember(client, testMemberUser.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("GET /api/me/checkin", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/me/checkin");
      expectUnauthorized(res);
    });

    it("should return check-in status and history", async () => {
      const res = await client.get("/api/me/checkin");
      const body = expectSuccess(res, 200);
      expect(body.canCheckIn).toBeDefined();
      expect(body.recentCheckIns).toBeInstanceOf(Array);
      expect(body.currentStreak).toBeDefined();
    });
  });

  describe("POST /api/me/checkin", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/me/checkin", {});
      expectUnauthorized(res);
    });

    it("should check in member successfully", async () => {
      const res = await client.post("/api/me/checkin", {});
      const body = expectSuccess(res, 200);
      expect(body.checkIn).toBeDefined();
      expect(body.checkIn.memberId).toBe(testMember.id);
      expect(body.checkIn.method).toBe("SELF");
      expect(body.checkIn.outcome).toBe("SUCCESS");
    });

    it("should reject check-in without active membership", async () => {
      // Archive the membership
      await prisma.membership.updateMany({
        where: { memberId: testMember.id },
        data: { status: "EXPIRED" },
      });

      const res = await client.post("/api/me/checkin", {});
      expectError(res, 403, "no_active_membership");
    });

    it("should reject duplicate check-in same day", async () => {
      // First check-in
      await client.post("/api/me/checkin", {});

      // Second check-in same day
      const res = await client.post("/api/me/checkin", {});
      expectError(res, 409, "already_checked_in");
    });
  });

  describe("GET /api/me/renew", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/me/renew");
      expectUnauthorized(res);
    });

    it("should return renewal options", async () => {
      const res = await client.get("/api/me/renew");
      const body = expectSuccess(res, 200);
      expect(body.currentMembership).toBeDefined();
      expect(body.plans).toBeInstanceOf(Array);
      expect(body.plans.length).toBeGreaterThan(0);
    });

    it("should show expiring membership", async () => {
      // Create expiring membership
      await prisma.membership.updateMany({
        where: { memberId: testMember.id },
        data: { endDate: new Date(Date.now() + 3 * 86400000) }, // 3 days
      });

      const res = await client.get("/api/me/renew");
      const body = expectSuccess(res, 200);
      expect(body.currentMembership.daysUntilExpiry).toBeLessThanOrEqual(7);
    });
  });

  describe("POST /api/me/renew", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/me/renew", { planId: testPlan.id });
      expectUnauthorized(res);
    });

    it("should validate planId", async () => {
      const res = await client.post("/api/me/renew", { planId: "invalid" });
      expectValidationError(res, "planId");
    });

    it("should start renewal checkout", async () => {
      const res = await client.post("/api/me/renew", { 
        planId: testPlan.id,
        provider: "sandbox",
      });
      const body = expectSuccess(res, 200);
      expect(body.payment).toBeDefined();
      expect(body.payment.purpose).toBe("MEMBERSHIP");
      expect(body.checkoutUrl).toBeDefined();
    });

    it("should apply coupon to renewal", async () => {
      const coupon = await prisma.coupon.create({
        data: testData.coupon(testGym.id, { code: "RENEW10", value: 15, kind: "PERCENT" }),
      });

      const res = await client.post("/api/me/renew", { 
        planId: testPlan.id,
        provider: "sandbox",
        couponCode: coupon.code,
      });
      const body = expectSuccess(res, 200);
      expect(body.payment.couponId).toBe(coupon.id);
    });
  });

  describe("GET /api/me/orders", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/me/orders");
      expectUnauthorized(res);
    });

    it("should return member orders", async () => {
      const res = await client.get("/api/me/orders");
      const body = expectSuccess(res, 200);
      expect(body.orders).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
    });

    it("should filter by status", async () => {
      const res = await client.get("/api/me/orders?status=PAID");
      const body = expectSuccess(res, 200);
      expect(body.orders.every((o: any) => o.status === "PAID")).toBe(true);
    });
  });

  describe("GET /api/me/coupon", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/me/coupon");
      expectUnauthorized(res);
    });

    it("should return available coupons for member", async () => {
      const coupon = await prisma.coupon.create({
        data: testData.coupon(testGym.id, { code: "MEMBER20", value: 20, kind: "PERCENT", appliesTo: "ALL" }),
      });

      const res = await client.get("/api/me/coupon");
      const body = expectSuccess(res, 200);
      expect(body.coupons).toBeInstanceOf(Array);
      expect(body.coupons.some((c: any) => c.code === "MEMBER20")).toBe(true);
    });
  });

  describe("GET /api/me/pass", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/me/pass");
      expectUnauthorized(res);
    });

    it("should return member pass with QR code", async () => {
      const res = await client.get("/api/me/pass");
      const body = expectSuccess(res, 200);
      expect(body.pass).toBeDefined();
      expect(body.pass.qrCode).toBeDefined();
      expect(body.pass.memberCode).toBe(testMember.memberCode);
      expect(body.pass.gymName).toBe(testGym.name);
    });
  });

  describe("GET /api/notifications", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/notifications");
      expectUnauthorized(res);
    });

    it("should return member notifications", async () => {
      // Create test notifications
      await prisma.notification.create({
        data: {
          userId: testMemberUser.id,
          channel: "IN_APP",
          category: "test",
          title: "Test Notification",
          body: "Test body",
          status: "SENT",
        },
      });

      const res = await client.get("/api/notifications");
      const body = expectSuccess(res, 200);
      expect(body.notifications).toBeInstanceOf(Array);
      expect(body.notifications.length).toBeGreaterThan(0);
    });

    it("should support pagination", async () => {
      const res = await client.get("/api/notifications?page=1&limit=5");
      const body = expectSuccess(res, 200);
      expect(body.pagination.limit).toBe(5);
    });

    it("should filter unread", async () => {
      const res = await client.get("/api/notifications?unreadOnly=true");
      const body = expectSuccess(res, 200);
      expect(body.notifications.every((n: any) => !n.readAt)).toBe(true);
    });
  });

  describe("GET /api/notifications/preferences", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/notifications/preferences");
      expectUnauthorized(res);
    });

    it("should return notification preferences", async () => {
      const res = await client.get("/api/notifications/preferences");
      const body = expectSuccess(res, 200);
      expect(body.preferences).toBeInstanceOf(Array);
    });
  });

  describe("PATCH /api/notifications/preferences", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.patch("/api/notifications/preferences", { 
        preferences: [{ category: "test", channel: "EMAIL", enabled: false }] 
      });
      expectUnauthorized(res);
    });

    it("should update preferences", async () => {
      const res = await client.patch("/api/notifications/preferences", {
        preferences: [
          { category: "membership", channel: "EMAIL", enabled: true },
          { category: "membership", channel: "PUSH", enabled: false },
        ],
      });
      const body = expectSuccess(res, 200);
      expect(body.preferences.length).toBe(2);
    });
  });
});