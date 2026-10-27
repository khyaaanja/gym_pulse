import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, cleanupTestData, seedTestGym, testData, expectSuccess, expectError, registerCleanup } from "./helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import crypto from "crypto";

// Import route handlers
import * as paymentsWebhookRoute from "@/app/api/webhooks/payments/[provider]/route";
import * as devicesCheckinRoute from "@/app/api/devices/checkin/route";
import * as paymentReturnRoute from "@/app/api/payments/return/[provider]/route";

// Mock Next.js request/response
function createMockRequest(method: string, url: string, body?: any, headers?: Record<string, string>, params?: Record<string, string>) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => searchParams.set(k, v));
  }
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
    nextUrl: { searchParams },
  } as any;
}

function createMockResponse() {
  const headers: Record<string, string> = {};
  return {
    status: 200,
    headers,
    json: vi.fn((data) => data),
    text: vi.fn((data) => data),
    redirect: vi.fn((url: string) => { headers.location = url; }),
    setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
  } as any;
}

describe("API Contract Tests - Webhook Routes", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testMember: any;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);

    // Mount route handlers
    app.post("/api/webhooks/payments/:provider", async (req, res) => {
      const mockReq = createMockRequest("POST", `/api/webhooks/payments/${req.params.provider}`, req.body, req.headers as any, { provider: req.params.provider });
      const mockRes = createMockResponse();
      await paymentsWebhookRoute.POST(mockReq, mockRes, { params: Promise.resolve({ provider: req.params.provider }) });
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/payments/return/:provider", async (req, res) => {
      const mockReq = createMockRequest("GET", `/api/payments/return/${req.params.provider}`, undefined, req.headers as any, { provider: req.params.provider });
      const mockRes = createMockResponse();
      await paymentReturnRoute.GET(mockReq, mockRes, { params: Promise.resolve({ provider: req.params.provider }) });
      if (mockRes.headers.location) {
        res.redirect(mockRes.headers.location);
      } else {
        res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
      }
    });

    app.post("/api/devices/checkin", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/devices/checkin", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await devicesCheckinRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    // Seed test data
    const { gym } = await seedTestGym();
    testGym = gym;

    testMember = await prisma.member.create({
      data: testData.member(testGym.id, { fullName: "Webhook Test Member" }),
    });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("POST /api/webhooks/payments/:provider", () => {
    describe("eSewa webhook", () => {
      it("should reject missing signature", async () => {
        const res = await client.post("/api/webhooks/payments/esewa", { 
          transaction_uuid: "test-123",
          status: "COMPLETE",
        });
        expectError(res, 400, "missing_signature");
      });

      it("should reject invalid signature", async () => {
        const res = await client.post("/api/webhooks/payments/esewa", { 
          transaction_uuid: "test-123",
          status: "COMPLETE",
        }, { "x-esewa-signature": "invalid-signature" });
        expectError(res, 401, "invalid_signature");
      });

      it("should process successful payment", async () => {
        // Create pending payment
        const payment = await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            provider: "esewa",
            reference: "esewa-ref-123",
            status: "PENDING",
            amountPaisa: 500000,
          }),
        });

        // Mock signature verification
        const payload = { transaction_uuid: payment.reference, status: "COMPLETE", total_amount: 5000 };
        const signature = "valid-signature"; // In real test, would compute HMAC

        vi.spyOn(crypto, "createHmac").mockReturnValue({
          update: vi.fn().mockReturnThis(),
          digest: vi.fn().mockReturnValue(signature),
        } as any);

        const res = await client.post("/api/webhooks/payments/esewa", payload, { 
          "x-esewa-signature": signature 
        });
        
        expectSuccess(res, 200);
        
        const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(updatedPayment?.status).toBe("SUCCEEDED");
      });

      it("should handle failed payment", async () => {
        const payment = await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            provider: "esewa",
            reference: "esewa-ref-456",
            status: "PENDING",
          }),
        });

        const res = await client.post("/api/webhooks/payments/esewa", { 
          transaction_uuid: payment.reference,
          status: "FAILED",
        }, { "x-esewa-signature": "valid-signature" });
        
        expectSuccess(res, 200);
        
        const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(updatedPayment?.status).toBe("FAILED");
      });

      it("should be idempotent", async () => {
        const payment = await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            provider: "esewa",
            reference: "esewa-ref-789",
            status: "PENDING",
          }),
        });

        // Process twice
        await client.post("/api/webhooks/payments/esewa", { 
          transaction_uuid: payment.reference,
          status: "COMPLETE",
        }, { "x-esewa-signature": "valid-signature" });
        
        const res = await client.post("/api/webhooks/payments/esewa", { 
          transaction_uuid: payment.reference,
          status: "COMPLETE",
        }, { "x-esewa-signature": "valid-signature" });
        
        expectSuccess(res, 200);
        
        // Should only have one webhook event recorded
        const webhookEvents = await prisma.paymentWebhookEvent.findMany({
          where: { paymentId: payment.id },
        });
        expect(webhookEvents.length).toBe(1);
      });
    });

    describe("Khalti webhook", () => {
      it("should verify Khalti signature", async () => {
        const res = await client.post("/api/webhooks/payments/khalti", { 
          idx: "khalti-123",
          status: "Completed",
        });
        expectError(res, 400, "missing_signature");
      });
    });

    describe("Stripe webhook", () => {
      it("should verify Stripe signature", async () => {
        const res = await client.post("/api/webhooks/payments/stripe", { 
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_123" } },
        });
        expectError(res, 400, "missing_signature");
      });
    });
  });

  describe("GET /api/payments/return/:provider", () => {
    describe("eSewa return", () => {
      it("should redirect to success page on completion", async () => {
        const payment = await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            provider: "esewa",
            reference: "esewa-return-123",
            status: "PENDING",
          }),
        });

        const res = await client.get(`/api/payments/return/esewa?transaction_uuid=${payment.reference}&status=COMPLETE&total_amount=5000`);
        
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/app/receipts/");
      });

      it("should redirect to failure page on failure", async () => {
        const payment = await prisma.payment.create({
          data: testData.payment(testGym.id, testMember.id, { 
            provider: "esewa",
            reference: "esewa-return-456",
            status: "PENDING",
          }),
        });

        const res = await client.get(`/api/payments/return/esewa?transaction_uuid=${payment.reference}&status=FAILED`);
        
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/app/renew?error=payment_failed");
      });
    });

    describe("Khalti return", () => {
      it("should handle Khalti return", async () => {
        const res = await client.get("/api/payments/return/khalti?status=Completed&transaction_id=khalti-123");
        // Should redirect appropriately
        expect([200, 302]).toContain(res.status);
      });
    });
  });

  describe("POST /api/devices/checkin", () => {
    it("should require device authentication", async () => {
      const res = await client.post("/api/devices/checkin", { memberId: testMember.id });
      expectUnauthorized(res);
    });

    it("should validate device key", async () => {
      // Create a check-in device
      const device = await prisma.checkInDevice.create({
        data: {
          gymId: testGym.id,
          name: "Front Desk Kiosk",
          kind: "KIOSK",
          keyHash: "hashed-key",
          keyPrefix: "dev_",
          active: true,
        },
      });

      // Try with invalid key
      const res = await client.post("/api/devices/checkin", { 
        memberId: testMember.id,
        deviceKey: "invalid_key",
      });
      expectError(res, 401, "invalid_device_key");
    });

    it("should check in member via device", async () => {
      const device = await prisma.checkInDevice.create({
        data: {
          gymId: testGym.id,
          name: "Front Desk Kiosk",
          kind: "KIOSK",
          keyHash: await hashPassword("valid_device_key"),
          keyPrefix: "dev_",
          active: true,
        },
      });

      // Create active membership
      await prisma.membership.create({
        data: {
          gymId: testGym.id,
          memberId: testMember.id,
          planId: (await prisma.membershipPlan.findFirst({ where: { gymId: testGym.id } }))!.id,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 86400000),
          pricePaisa: 500000,
          status: "ACTIVE",
        },
      });

      const res = await client.post("/api/devices/checkin", { 
        memberId: testMember.id,
        deviceKey: "valid_device_key",
      });
      
      const body = expectSuccess(res, 200);
      expect(body.checkIn).toBeDefined();
      expect(body.checkIn.method).toBe("DEVICE");
      expect(body.checkIn.deviceId).toBe(device.id);
    });

    it("should reject inactive device", async () => {
      const device = await prisma.checkInDevice.create({
        data: {
          gymId: testGym.id,
          name: "Inactive Kiosk",
          kind: "KIOSK",
          keyHash: await hashPassword("inactive_key"),
          keyPrefix: "dev_",
          active: false,
        },
      });

      const res = await client.post("/api/devices/checkin", { 
        memberId: testMember.id,
        deviceKey: "inactive_key",
      });
      expectError(res, 403, "device_inactive");
    });

    it("should reject check-in for member without active membership", async () => {
      const device = await prisma.checkInDevice.create({
        data: {
          gymId: testGym.id,
          name: "Front Desk Kiosk",
          kind: "KIOSK",
          keyHash: await hashPassword("valid_device_key"),
          keyPrefix: "dev_",
          active: true,
        },
      });

      // Member without membership
      const noMembershipMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "No Membership Member" }),
      });

      const res = await client.post("/api/devices/checkin", { 
        memberId: noMembershipMember.id,
        deviceKey: "valid_device_key",
      });
      expectError(res, 403, "no_active_membership");
    });
  });
});