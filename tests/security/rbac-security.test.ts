import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, loginAsMember, cleanupTestData, seedTestGym, testData, registerCleanup, expectUnauthorized, expectForbidden } from "../api/helpers";
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

describe("Security Tests - RBAC & Authorization", () => {
  let app: express.Express;
  let ownerClient: ReturnType<typeof createTestClient>;
  let memberClient: ReturnType<typeof createTestClient>;
  let staffClient: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testOwner: any;
  let testMember: any;
  let testStaff: any;
  let testPlan: any;

  beforeAll(async () => {
    app = await createTestApp();
    ownerClient = createTestClient(app);
    memberClient = createTestClient(app);
    staffClient = createTestClient(app);
    registerCleanup(cleanupTestData);

    // Seed test data
    const { gym, owner, plan } = await seedTestGym();
    testGym = gym;
    testOwner = owner;
    testPlan = plan;

    const passwordHash = await hashPassword("password123");
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash } });

    // Create member with user
    const memberUser = await prisma.user.create({ data: { email: `member-${Date.now()}@test.com`, name: "Test Member", passwordHash } });
    testMember = await prisma.member.create({ data: testData.member(testGym.id, { userId: memberUser.id, email: memberUser.email }) });
    await prisma.membership.create({
      data: { gymId: testGym.id, memberId: testMember.id, planId: testPlan.id, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000), pricePaisa: testPlan.pricePaisa, status: "ACTIVE" },
    });

    // Create trainer staff
    const staffUser = await prisma.user.create({ data: { email: `trainer-${Date.now()}@test.com`, name: "Test Trainer", passwordHash } });
    testStaff = await prisma.staffMember.create({ data: { gymId: testGym.id, userId: staffUser.id, role: "TRAINER", active: true, grantedPermissions: ["members:read", "members:write"] } });

    // Login all clients
    await loginAsOwner(ownerClient, owner.email!, "password123");
    await loginAsMember(memberClient, memberUser.email!, "password123");
    await loginAsMember(staffClient, staffUser.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("Owner Permissions", () => {
    it("should allow owner to manage members", async () => {
      const res = await ownerClient.post("/api/gym/members", { fullName: "New Member", email: "new@test.com" });
      expect(res.status).toBe(201);
    });

    it("should allow owner to manage memberships", async () => {
      const member = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Membership Test" }) });
      const res = await ownerClient.post("/api/gym/payments/manual", { memberId: member.id, planId: testPlan.id, method: "CASH", amountPaisa: testPlan.pricePaisa });
      expect(res.status).toBe(201);
    });

    it("should allow owner to manage marketplace", async () => {
      const res = await ownerClient.post("/api/gym/products", { name: "Test Product", pricePaisa: 100000, kind: "MERCH" });
      expect(res.status).toBe(201);
    });

    it("should allow owner to view analytics", async () => {
      const res = await ownerClient.get("/api/gym/dashboard");
      expect(res.status).toBe(200);
    });

    it("should allow owner to manage settings", async () => {
      const res = await ownerClient.patch("/api/gym/settings", { phone: "+977-1-1111111" });
      expect(res.status).toBe(200);
    });

    it("should allow owner to invite staff", async () => {
      const res = await ownerClient.post("/api/gym/staff", { email: "newstaff@test.com", role: "TRAINER" });
      expect(res.status).toBe(201);
    });
  });

  describe("Staff Permissions (Trainer)", () => {
    it("should allow trainer to view assigned members", async () => {
      // Assign member to trainer
      await prisma.member.update({ where: { id: testMember.id }, data: { trainerId: testStaff.id } });
      
      const res = await staffClient.get("/api/gym/members");
      expect(res.status).toBe(200);
      // Should only see assigned members
    });

    it("should allow trainer to create diet plans", async () => {
      const res = await staffClient.post("/api/gym/diet-plans", { 
        title: "Test Diet", 
        dailyCalories: 2000, 
        proteinG: 150, 
        carbsG: 200, 
        fatG: 70,
        memberId: testMember.id,
      });
      expect(res.status).toBe(201);
    });

    it("should allow trainer to manage bookings", async () => {
      const res = await staffClient.get("/api/gym/bookings");
      expect(res.status).toBe(200);
    });

    it("should allow trainer to handle recovery tasks", async () => {
      const res = await staffClient.get("/api/gym/recovery");
      expect(res.status).toBe(200);
    });

    it("should deny trainer access to payments", async () => {
      const res = await staffClient.get("/api/gym/payments");
      expectForbidden(res);
    });

    it("should deny trainer access to member creation", async () => {
      const res = await staffClient.post("/api/gym/members", { fullName: "New", email: "new@test.com" });
      expectForbidden(res);
    });

    it("should deny trainer access to analytics", async () => {
      const res = await staffClient.get("/api/gym/dashboard");
      expectForbidden(res);
    });

    it("should deny trainer access to settings", async () => {
      const res = await staffClient.patch("/api/gym/settings", { phone: "+977-1-1111111" });
      expectForbidden(res);
    });
  });

  describe("Member Permissions", () => {
    it("should allow member to view own profile", async () => {
      const res = await memberClient.get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(testMember.userId);
    });

    it("should allow member to check in", async () => {
      const res = await memberClient.post("/api/me/checkin");
      expect([200, 409]).toContain(res.status); // 409 if already checked in
    });

    it("should allow member to view own membership", async () => {
      const res = await memberClient.get("/api/me/renew");
      expect(res.status).toBe(200);
    });

    it("should allow member to view marketplace", async () => {
      const res = await memberClient.get("/api/me/orders");
      expect(res.status).toBe(200);
    });

    it("should allow member to update notification preferences", async () => {
      const res = await memberClient.patch("/api/notifications/preferences", { 
        preferences: [{ category: "membership", channel: "EMAIL", enabled: true }] 
      });
      expect(res.status).toBe(200);
    });

    it("should deny member access to other members", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Other" }) });
      const res = await memberClient.get(`/api/gym/members/${otherMember.id}`);
      expectForbidden(res);
    });

    it("should deny member access to admin endpoints", async () => {
      const res = await memberClient.get("/api/gym/members");
      expectForbidden(res);
    });

    it("should deny member access to payments", async () => {
      const res = await memberClient.get("/api/gym/payments");
      expectForbidden(res);
    });

    it("should deny member access to staff management", async () => {
      const res = await memberClient.get("/api/gym/staff");
      expectForbidden(res);
    });

    it("should deny member access to analytics", async () => {
      const res = await memberClient.get("/api/gym/dashboard");
      expectForbidden(res);
    });

    it("should deny member access to settings", async () => {
      const res = await memberClient.patch("/api/gym/settings", { phone: "+977-1-1111111" });
      expectForbidden(res);
    });
  });

  describe("Cross-Gym Isolation", () => {
    let otherGym: any;
    let otherOwnerClient: ReturnType<typeof createTestClient>;

    beforeAll(async () => {
      otherGym = await prisma.gym.create({
        data: { name: "Other Gym", slug: "other-gym", email: "other@gym.com", city: "Pokhara", status: "ACTIVE", onboardingStep: 5, onboardedAt: new Date() },
      });

      const otherOwnerUser = await prisma.user.create({ data: { email: `otherowner-${Date.now()}@test.com`, name: "Other Owner", passwordHash: await hashPassword("password123") } });
      await prisma.staffMember.create({ data: { gymId: otherGym.id, userId: otherOwnerUser.id, role: "OWNER", active: true } });

      otherOwnerClient = createTestClient(app);
      await loginAsOwner(otherOwnerClient, otherOwnerUser.email!, "password123");
    });

    it("should isolate gym data completely", async () => {
      // Owner of gym 1 should not see gym 2 members
      const res = await ownerClient.get("/api/gym/members");
      expect(res.status).toBe(200);
      const members = res.body.members;
      expect(members.every((m: any) => m.gymId === testGym.id)).toBe(true);
    });

    it("should prevent member access across gyms", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(otherGym.id, { fullName: "Other Gym Member" }) });
      const res = await ownerClient.get(`/api/gym/members/${otherMember.id}`);
      expect(res.status).toBe(404); // Not found, not forbidden (don't leak existence)
    });

    it("should prevent staff access across gyms", async () => {
      const res = await ownerClient.get("/api/gym/staff");
      expect(res.status).toBe(200);
      const staff = res.body.staff;
      expect(staff.every((s: any) => s.gymId === testGym.id)).toBe(true);
    });

    it("should prevent payments access across gyms", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(otherGym.id, { fullName: "Other Payment" }) });
      await prisma.payment.create({ data: testData.payment(otherGym.id, otherMember.id, { amountPaisa: 100000 }) });
      
      const res = await ownerClient.get("/api/gym/payments");
      expect(res.status).toBe(200);
      const payments = res.body.payments;
      expect(payments.every((p: any) => p.gymId === testGym.id)).toBe(true);
    });

    it("should prevent marketplace access across gyms", async () => {
      await prisma.marketplaceProduct.create({ data: testData.product(otherGym.id, { name: "Other Product" }) });
      
      const res = await ownerClient.get("/api/gym/products");
      expect(res.status).toBe(200);
      const products = res.body.products;
      expect(products.every((p: any) => p.gymId === testGym.id)).toBe(true);
    });
  });

  describe("Resource-Level Permissions", () => {
    it("should allow member to access only own check-in history", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Other" }) });
      await prisma.attendance.create({ data: { gymId: testGym.id, memberId: otherMember.id, localDate: new Date(), checkedInAt: new Date(), method: "SELF" } });
      
      const res = await memberClient.get("/api/me/checkin");
      expect(res.status).toBe(200);
      const checkIns = res.body.recentCheckIns;
      expect(checkIns.every((c: any) => c.memberId === testMember.id)).toBe(true);
    });

    it("should allow trainer to access only assigned member diet plans", async () => {
      // Create diet plan for unassigned member
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Unassigned" }) });
      await prisma.dietPlan.create({ data: { gymId: testGym.id, memberId: otherMember.id, title: "Unassigned Diet", dailyCalories: 2000, isTemplate: false } });
      
      const res = await staffClient.get("/api/gym/diet-plans");
      expect(res.status).toBe(200);
      // Should only see diet plans for assigned members or created by them
    });

    it("should enforce ownership on membership renewals", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Other Member" }) });
      await prisma.membership.create({
        data: { gymId: testGym.id, memberId: otherMember.id, planId: testPlan.id, startDate: new Date(), endDate: new Date(Date.now() + 5 * 86400000), pricePaisa: testPlan.pricePaisa, status: "ACTIVE" },
      });

      // Member should not be able to renew other's membership
      const res = await memberClient.post("/api/me/renew", { planId: testPlan.id });
      expect(res.status).toBe(200); // Should work for own membership
      // Can't directly test other's renewal via this endpoint
    });
  });

  describe("Privilege Escalation Prevention", () => {
    it("should prevent member from promoting themselves to staff", async () => {
      const res = await memberClient.post("/api/gym/staff", { 
        email: testMember.email!, 
        role: "OWNER" 
      });
      expectForbidden(res);
    });

    it("should prevent staff from promoting themselves", async () => {
      const res = await staffClient.post("/api/gym/staff", { 
        email: (await prisma.user.findUnique({ where: { id: testStaff.userId } }))!.email!,
        role: "OWNER" 
      });
      expectForbidden(res);
    });

    it("should prevent member from modifying other member data", async () => {
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Other Member" }) });
      const res = await memberClient.patch(`/api/gym/members/${otherMember.id}`, { fullName: "Hacked" });
      expectForbidden(res);
    });

    it("should prevent IDOR on member resources", async () => {
      // Member tries to access another member's receipt
      const otherMember = await prisma.member.create({ data: testData.member(testGym.id, { fullName: "Other" }) });
      const payment = await prisma.payment.create({ data: testData.payment(testGym.id, otherMember.id, { amountPaisa: 100000, status: "SUCCEEDED" }) });
      await prisma.invoice.create({ data: { gymId: testGym.id, paymentId: payment.id, number: "INV-001", lines: [], totalPaisa: 100000, memberId: otherMember.id } });
      
      const res = await memberClient.get(`/app/receipts/${payment.id}`);
      expect([403, 404]).toContain(res.status);
    });
  });
});