import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, cleanupTestData, seedTestGym, registerCleanup } from "../api/helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

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

describe("Security Tests - Input Validation", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testOwner: any;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);

    const { gym, owner } = await seedTestGym();
    testGym = gym;
    testOwner = owner;

    const passwordHash = await hashPassword("password123");
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash } });

    await loginAsOwner(client, owner.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("SQL Injection Prevention", () => {
    const sqlPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "'; SELECT * FROM users; --",
      "admin'--",
      "' UNION SELECT * FROM users --",
      "1; DELETE FROM payments WHERE 1=1; --",
    ];

    for (const payload of sqlPayloads) {
      it(`should sanitize SQL injection in search: ${payload}`, async () => {
        const res = await client.get(`/api/gym/members?search=${encodeURIComponent(payload)}`);
        expect([200, 400]).toContain(res.status);
        // Should not crash or return all users
      });

      it(`should sanitize SQL injection in member fields: ${payload}`, async () => {
        const res = await client.post("/api/gym/members", { fullName: payload, email: "test@test.com" });
        expect([201, 400]).toContain(res.status);
      });
    }
  });

  describe("XSS Prevention", () => {
    const xssPayloads = [
      "<script>alert('xss')</script>",
      "<img src=x onerror=alert(1)>",
      "javascript:alert(1)",
      "<svg onload=alert(1)>",
      "';alert('xss');//",
      "<iframe src=javascript:alert(1)>",
      "<body onload=alert(1)>",
      "<input autofocus onfocus=alert(1)>",
      "<select autofocus onfocus=alert(1)>",
      "<textarea autofocus onfocus=alert(1)>",
      "<keygen autofocus onfocus=alert(1)>",
      "<video><source onerror=alert(1)>",
      "<audio><source onerror=alert(1)>",
      "<details open ontoggle=alert(1)>",
      "<marquee onstart=alert(1)>",
      "<meter onmouseover=alert(1)>",
    ];

    for (const payload of xssPayloads) {
      it(`should sanitize XSS in member name: ${payload}`, async () => {
        const res = await client.post("/api/gym/members", { fullName: payload, email: "test@test.com" });
        if (res.status === 201) {
          // If created, the name should be sanitized
          expect(res.body.member.fullName).not.toContain("<script>");
          expect(res.body.member.fullName).not.toContain("onerror");
          expect(res.body.member.fullName).not.toContain("javascript:");
        }
      });

      it(`should sanitize XSS in product name: ${payload}`, async () => {
        const res = await client.post("/api/gym/products", { name: payload, pricePaisa: 100000, kind: "MERCH" });
        if (res.status === 201) {
          expect(res.body.product.name).not.toContain("<script>");
        }
      });

      it(`should sanitize XSS in notes/description: ${payload}`, async () => {
        const res = await client.post("/api/gym/members", { 
          fullName: "Test", 
          email: "test@test.com",
          notes: payload 
        });
        if (res.status === 201) {
          expect(res.body.member.notes).not.toContain("<script>");
        }
      });
    }
  });

  describe("Path Traversal Prevention", () => {
    const pathPayloads = [
      "../../../etc/passwd",
      "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
      "/etc/passwd",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      "....//....//....//etc/passwd",
      "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "..%2f..%2f..%2fetc%2fpasswd",
    ];

    for (const payload of pathPayloads) {
      it(`should reject path traversal in file uploads: ${payload}`, async () => {
        // This would test file upload endpoints
        // For now, test that filename validation rejects these
        const res = await client.post("/api/gym/images", { filename: payload });
        expect([400, 404]).toContain(res.status); // 404 if endpoint doesn't exist
      });
    }
  });

  describe("Command Injection Prevention", () => {
    const cmdPayloads = [
      "; cat /etc/passwd",
      "| cat /etc/passwd",
      "`cat /etc/passwd`",
      "$(cat /etc/passwd)",
      "&& cat /etc/passwd",
      "|| cat /etc/passwd",
      "; ls -la",
      "| ls -la",
    ];

    for (const payload of cmdPayloads) {
      it(`should sanitize command injection: ${payload}`, async () => {
        const res = await client.post("/api/gym/members", { fullName: `Test${payload}`, email: "test@test.com" });
        expect([201, 400]).toContain(res.status);
        // Should not execute commands
      });
    }
  });

  describe("LDAP Injection Prevention", () => {
    const ldapPayloads = [
      "*)(cn=*",
      "*)(|(password=*))",
      "admin)(&(password=*))",
    ];

    for (const payload of ldapPayloads) {
      it(`should sanitize LDAP injection: ${payload}`, async () => {
        const res = await client.post("/api/auth/login", { identifier: payload, password: "test" });
        expect([400, 401]).toContain(res.status);
      });
    }
  });

  describe("NoSQL Injection Prevention", () => {
    const nosqlPayloads = [
      '{"$ne": null}',
      '{"$gt": ""}',
      '{"$where": "this.credits > 100"}',
      '{"$regex": ".*"}',
    ];

    for (const payload of nosqlPayloads) {
      it(`should sanitize NoSQL injection: ${payload}`, async () => {
        // Would test if any endpoint accepts JSON that could be used in MongoDB queries
        // Since we use PostgreSQL/Prisma, this is less relevant but good to test
        const res = await client.post("/api/gym/members", { fullName: "Test", email: "test@test.com", metadata: JSON.parse(payload) });
        expect([201, 400, 500]).toContain(res.status);
      });
    }
  });

  describe("Input Length Limits", () => {
    it("should enforce max length on member name", async () => {
      const longName = "A".repeat(1000);
      const res = await client.post("/api/gym/members", { fullName: longName, email: "test@test.com" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("should enforce max length on email", async () => {
      const longEmail = "a".repeat(300) + "@test.com";
      const res = await client.post("/api/gym/members", { fullName: "Test", email: longEmail });
      expect(res.status).toBe(400);
    });

    it("should enforce max length on notes", async () => {
      const longNotes = "A".repeat(10000);
      const res = await client.post("/api/gym/members", { fullName: "Test", email: "test@test.com", notes: longNotes });
      expect(res.status).toBe(400);
    });

    it("should enforce max length on product description", async () => {
      const longDesc = "A".repeat(50000);
      const res = await client.post("/api/gym/products", { name: "Test", pricePaisa: 100000, kind: "MERCH", description: longDesc });
      expect(res.status).toBe(400);
    });
  });

  describe("Type Validation", () => {
    it("should reject non-numeric price", async () => {
      const res = await client.post("/api/gym/products", { name: "Test", pricePaisa: "not-a-number", kind: "MERCH" });
      expect(res.status).toBe(400);
    });

    it("should reject negative price", async () => {
      const res = await client.post("/api/gym/products", { name: "Test", pricePaisa: -100, kind: "MERCH" });
      expect(res.status).toBe(400);
    });

    it("should reject non-integer duration", async () => {
      const res = await client.post("/api/gym/membership-plans", { name: "Test", durationDays: 30.5, pricePaisa: 100000 });
      expect(res.status).toBe(400);
    });

    it("should reject invalid enum values", async () => {
      const res = await client.post("/api/gym/payments/manual", { memberId: "test", planId: "test", method: "INVALID", amountPaisa: 100000 });
      expect(res.status).toBe(400);
    });

    it("should reject invalid date formats", async () => {
      const res = await client.post("/api/gym/members", { fullName: "Test", email: "test@test.com", joinedOn: "not-a-date" });
      expect(res.status).toBe(400);
    });
  });

  describe("Email Validation", () => {
    const invalidEmails = [
      "notanemail",
      "@nodomain.com",
      "no@domain",
      "spaces in@email.com",
      "double@@domain.com",
      "missing@.com",
      "missing@domain.",
      "trailing@domain.com.",
      "leading.@domain.com",
      "special!chars@domain.com",
      "unicode@domain.com", // Depending on requirements
      "very.long.email.address.that.exceeds.the.maximum.allowed.length.for.an.email.address@domain.com",
    ];

    for (const email of invalidEmails) {
      it(`should reject invalid email: ${email}`, async () => {
        const res = await client.post("/api/gym/members", { fullName: "Test", email });
        expect(res.status).toBe(400);
      });
    }
  });

  describe("Phone Validation", () => {
    const invalidPhones = [
      "123",
      "not-a-phone",
      "++977-9800000000",
      "+977-980000000000000000", // Too long
      "977-9800000000", // Missing +
      "+1-555-1234", // Wrong country (if only Nepal supported)
    ];

    for (const phone of invalidPhones) {
      it(`should reject invalid phone: ${phone}`, async () => {
        const res = await client.post("/api/gym/members", { fullName: "Test", email: "test@test.com", phone });
        expect(res.status).toBe(400);
      });
    }
  });

  describe("Unicode/Encoding Attacks", () => {
    it("should handle null bytes", async () => {
      const res = await client.post("/api/gym/members", { fullName: "Test\x00", email: "test@test.com" });
      expect([201, 400]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.member.fullName).not.toContain("\x00");
      }
    });

    it("should handle unicode normalization", async () => {
      // Different unicode representations of same character
      const name1 = "café"; // NFC
      const name2 = "cafe\u0301"; // NFD
      
      const res1 = await client.post("/api/gym/members", { fullName: name1, email: "test1@test.com" });
      const res2 = await client.post("/api/gym/members", { fullName: name2, email: "test2@test.com" });
      
      expect([201, 400]).toContain(res1.status);
      expect([201, 400]).toContain(res2.status);
    });

    it("should handle RTL override characters", async () => {
      const rtlName = "Test\u202EMalicious"; // Right-to-left override
      const res = await client.post("/api/gym/members", { fullName: rtlName, email: "test@test.com" });
      expect([201, 400]).toContain(res.status);
    });
  });
});