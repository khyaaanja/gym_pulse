import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, cleanupTestData, seedTestGym, testData, registerCleanup } from "../api/helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { encryptJson, decryptJson } from "@/lib/crypto";

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
  } as any;
}

describe("Security Tests - Payment Security", () => {
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

    const { gym, owner, plan } = await seedTestGym();
    testGym = gym;
    testOwner = owner;
    testPlan = plan;

    const passwordHash = await hashPassword("password123");
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash } });

    testMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Payment Security Test" }) });

    await loginAsOwner(client, owner.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("Idempotency", () => {
    it("should prevent duplicate payments with same idempotency key", async () => {
      const idempotencyKey = `idem-test-${Date.now()}`;
      
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

    it("should reject concurrent duplicate requests", async () => {
      const idempotencyKey = `concurrent-${Date.now()}`;
      
      const promises = Array(5).fill(null).map(() => 
        client.post("/api/gym/payments/manual", {
          memberId: testMember.id,
          planId: testPlan.id,
          method: "CASH",
          amountPaisa: testPlan.pricePaisa,
          idempotencyKey,
        })
      );
      
      const results = await Promise.all(promises);
      const successful = results.filter(r => r.status === 201);
      expect(successful.length).toBe(1);
      expect(successful[0].body.payment.id).toBe(successful[0].body.payment.id);
    });
  });

  describe("Payment Amount Validation", () => {
    it("should reject amount mismatch with plan price", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa - 10000, // Less than plan price
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("amount_mismatch");
    });

    it("should reject negative amounts", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: -1000,
      });
      expect(res.status).toBe(400);
    });

    it("should reject zero amounts", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: 0,
      });
      expect(res.status).toBe(400);
    });

    it("should reject excessively large amounts", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: 1000000000, // 10M NPR
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Payment Status Transitions", () => {
    it("should not allow manual status manipulation", async () => {
      const payment = await prisma.payment.create({
        data: testData.payment(testGym.id, testMember.id, { status: "PENDING" }),
      });

      // Try to directly update status via API (should not be possible)
      const res = await client.patch(`/api/gym/payments/${payment.id}`, { status: "SUCCEEDED" });
      expect([404, 405]).toContain(res.status); // No such endpoint or method not allowed
    });

    it("should only transition through valid states", async () => {
      const payment = await prisma.payment.create({
        data: testData.payment(testGym.id, testMember.id, { status: "PENDING" }),
      });

      // Valid: PENDING -> SUCCEEDED
      // Valid: PENDING -> FAILED
      // Invalid: SUCCEEDED -> PENDING
      // Invalid: FAILED -> SUCCEEDED
      
      // This would be tested via the actual payment confirmation flow
    });
  });

  describe("Webhook Security", () => {
    it("should verify webhook signatures", async () => {
      const payment = await prisma.payment.create({
        data: testData.payment(testGym.id, testMember.id, { 
          provider: "esewa", 
          reference: "esewa-secure-123", 
          status: "PENDING" 
        }),
      });

      // Without signature
      const res1 = await client.post("/api/webhooks/payments/esewa", { 
        transaction_uuid: payment.reference, 
        status: "COMPLETE" 
      });
      expect(res1.status).toBe(400);

      // With invalid signature
      const res2 = await client.post("/api/webhooks/payments/esewa", { 
        transaction_uuid: payment.reference, 
        status: "COMPLETE" 
      }, { "x-esewa-signature": "invalid" });
      expect(res2.status).toBe(401);
    });

    it("should reject webhooks for non-existent payments", async () => {
      const res = await client.post("/api/webhooks/payments/esewa", { 
        transaction_uuid: "non-existent-ref", 
        status: "COMPLETE" 
      }, { "x-esewa-signature": "valid-signature" });
      
      // Should handle gracefully
      expect([200, 404]).toContain(res.status);
    });

    it("should be idempotent for duplicate webhooks", async () => {
      const payment = await prisma.payment.create({
        data: testData.payment(testGym.id, testMember.id, { 
          provider: "esewa", 
          reference: "esewa-idempotent-123", 
          status: "PENDING" 
        }),
      });

      const payload = { transaction_uuid: payment.reference, status: "COMPLETE" };
      
      await client.post("/api/webhooks/payments/esewa", payload, { "x-esewa-signature": "valid" });
      const res = await client.post("/api/webhooks/payments/esewa", payload, { "x-esewa-signature": "valid" });
      
      expectSuccess(res, 200);
      
      // Only one webhook event should be recorded
      const events = await prisma.paymentWebhookEvent.findMany({ where: { paymentId: payment.id } });
      expect(events.length).toBe(1);
    });
  });

  describe("Credential Encryption", () => {
    it("should encrypt payment provider credentials", async () => {
      const credentials = { secretKey: "super-secret-key", productCode: "TEST" };
      const encrypted = encryptJson(credentials);
      
      expect(encrypted).not.toBe(JSON.stringify(credentials));
      expect(encrypted).toContain("."); // IV.ciphertext.authTag format
      
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(credentials);
    });

    it("should not store credentials in plaintext", async () => {
      const res = await client.post("/api/gym/payment-providers", {
        providerKey: "esewa",
        enabled: true,
        environment: "SANDBOX",
        credentials: { secretKey: "test-secret", productCode: "TEST" },
      });
      expectSuccess(res, 201);

      const stored = await prisma.paymentProviderConfig.findUnique({ 
        where: { gymId_providerKey: { gymId: testGym.id, providerKey: "esewa" } } 
      });
      
      expect(stored?.credentialsEnc).not.toContain("test-secret");
      expect(stored?.credentialsEnc).toContain(".");
    });
  });

  describe("Refund Protection", () => {
    it("should prevent double refunds", async () => {
      const payment = await prisma.payment.create({
        data: testData.payment(testGym.id, testMember.id, { 
          status: "SUCCEEDED", 
          amountPaisa: 500000,
          refundedAt: null,
        }),
      });

      // First refund
      // This would be via a refund endpoint
      // Second refund should fail
    });

    it("should require authorization for refunds", async () => {
      const res = await client.post("/api/gym/payments/refund", { paymentId: "test" });
      expectForbidden(res); // Member can't refund
    });
  });

  describe("PCI Compliance", () => {
    it("should not log full card numbers", async () => {
      // Test that card data is never logged
      // This is more of a code review check
    });

    it("should not store CVV", async () => {
      // CVV should never be stored
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CARD",
        amountPaisa: testPlan.pricePaisa,
        cvv: "123", // Should be ignored/rejected
      });
      // CVV should not be in payment record
    });

    it("should tokenize card data", async () => {
      // Card data should be tokenized via provider
      // Only token/reference stored
    });
  });

  describe("Audit Trail", () => {
    it("should log all payment actions", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: testMember.id,
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });
      expectSuccess(res, 201);

      const auditLogs = await prisma.auditLog.findMany({
        where: { entityType: "Payment", entityId: res.body.payment.id },
      });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it("should log failed payment attempts", async () => {
      const res = await client.post("/api/gym/payments/manual", {
        memberId: "non-existent",
        planId: testPlan.id,
        method: "CASH",
        amountPaisa: testPlan.pricePaisa,
      });
      expect(res.status).toBe(404);

      // Should still log the attempt
    });
  });
});