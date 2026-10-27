import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTestApp, createTestClient, loginAsOwner, cleanupTestData, seedTestGym, testData, expectSuccess, expectError, expectUnauthorized, expectValidationError, expectForbidden, registerCleanup } from "./helpers";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

// Import route handlers
import * as membersRoute from "@/app/api/gym/members/route";
import * as memberDetailRoute from "@/app/api/gym/members/[id]/route";
import * as memberInviteRoute from "@/app/api/gym/members/[id]/invite/route";

// Mock Next.js request/response
function createMockRequest(method: string, url: string, body?: any, headers?: Record<string, string>, params?: Record<string, string>) {
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

describe("API Contract Tests - Gym Members Routes", () => {
  let app: express.Express;
  let client: ReturnType<typeof createTestClient>;
  let testGym: any;
  let testOwner: any;

  beforeAll(async () => {
    app = await createTestApp();
    client = createTestClient(app);
    registerCleanup(cleanupTestData);

    // Mount route handlers
    app.get("/api/gym/members", async (req, res) => {
      const mockReq = createMockRequest("GET", "/api/gym/members", undefined, req.headers as any);
      const mockRes = createMockResponse();
      await membersRoute.GET(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/gym/members", async (req, res) => {
      const mockReq = createMockRequest("POST", "/api/gym/members", req.body, req.headers as any);
      const mockRes = createMockResponse();
      await membersRoute.POST(mockReq, mockRes);
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.get("/api/gym/members/:id", async (req, res) => {
      const mockReq = createMockRequest("GET", `/api/gym/members/${req.params.id}`, undefined, req.headers as any);
      const mockRes = createMockResponse();
      await memberDetailRoute.GET(mockReq, mockRes, { params: Promise.resolve({ id: req.params.id }) });
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.patch("/api/gym/members/:id", async (req, res) => {
      const mockReq = createMockRequest("PATCH", `/api/gym/members/${req.params.id}`, req.body, req.headers as any);
      const mockRes = createMockResponse();
      await memberDetailRoute.PATCH(mockReq, mockRes, { params: Promise.resolve({ id: req.params.id }) });
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.delete("/api/gym/members/:id", async (req, res) => {
      const mockReq = createMockRequest("DELETE", `/api/gym/members/${req.params.id}`, undefined, req.headers as any);
      const mockRes = createMockResponse();
      await memberDetailRoute.DELETE(mockReq, mockRes, { params: Promise.resolve({ id: req.params.id }) });
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    app.post("/api/gym/members/:id/invite", async (req, res) => {
      const mockReq = createMockRequest("POST", `/api/gym/members/${req.params.id}/invite`, req.body, req.headers as any);
      const mockRes = createMockResponse();
      await memberInviteRoute.POST(mockReq, mockRes, { params: Promise.resolve({ id: req.params.id }) });
      res.status(mockRes.status).json(mockRes.json.mock.results[0]?.value || {});
    });

    // Seed test data
    const { gym, owner } = await seedTestGym();
    testGym = gym;
    testOwner = owner;

    const passwordHash = await hashPassword("password123");
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash },
    });

    await loginAsOwner(client, owner.email!, "password123");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("GET /api/gym/members", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get("/api/gym/members");
      expectUnauthorized(res);
    });

    it("should return empty list for new gym", async () => {
      const res = await client.get("/api/gym/members");
      const body = expectSuccess(res, 200);
      expect(body.members).toBeInstanceOf(Array);
      expect(body.members.length).toBe(0);
      expect(body.pagination).toBeDefined();
    });

    it("should return paginated members", async () => {
      // Create test members
      for (let i = 0; i < 5; i++) {
        await prisma.member.create({
          data: testData.member(testGym.id, { 
            memberCode: `M${Date.now()}-${i}`,
            fullName: `Member ${i}`,
            email: `member${i}@test.com`,
          }),
        });
      }

      const res = await client.get("/api/gym/members?page=1&limit=3");
      const body = expectSuccess(res, 200);
      expect(body.members.length).toBe(3);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(3);
      expect(body.pagination.total).toBe(5);
    });

    it("should filter by status", async () => {
      await prisma.member.create({
        data: testData.member(testGym.id, { 
          memberCode: `INACTIVE-${Date.now()}`,
          fullName: "Inactive Member",
          status: "INACTIVE",
        }),
      });

      const res = await client.get("/api/gym/members?status=ACTIVE");
      const body = expectSuccess(res, 200);
      expect(body.members.every((m: any) => m.status === "ACTIVE")).toBe(true);
    });

    it("should search by name", async () => {
      const res = await client.get("/api/gym/members?search=Member 1");
      const body = expectSuccess(res, 200);
      expect(body.members.some((m: any) => m.fullName.includes("Member 1"))).toBe(true);
    });

    it("should sort by createdAt desc by default", async () => {
      const res = await client.get("/api/gym/members?limit=5");
      const body = expectSuccess(res, 200);
      for (let i = 1; i < body.members.length; i++) {
        expect(new Date(body.members[i-1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(body.members[i].createdAt).getTime()
        );
      }
    });
  });

  describe("POST /api/gym/members", () => {
    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post("/api/gym/members", { fullName: "Test" });
      expectUnauthorized(res);
    });

    it("should validate required fields", async () => {
      const res = await client.post("/api/gym/members", {});
      expectValidationError(res, "fullName");
    });

    it("should validate email format", async () => {
      const res = await client.post("/api/gym/members", { fullName: "Test", email: "invalid" });
      expectValidationError(res, "email");
    });

    it("should validate phone format", async () => {
      const res = await client.post("/api/gym/members", { fullName: "Test", phone: "123" });
      expectValidationError(res, "phone");
    });

    it("should create member successfully", async () => {
      const res = await client.post("/api/gym/members", {
        fullName: "New Member",
        email: "newmember@test.com",
        phone: "+977-9800000001",
        joinedOn: new Date().toISOString().split("T")[0],
      });
      const body = expectSuccess(res, 201);
      expect(body.member).toBeDefined();
      expect(body.member.fullName).toBe("New Member");
      expect(body.member.email).toBe("newmember@test.com");
      expect(body.member.memberCode).toMatch(/^M\d+$/);
      expect(body.member.gymId).toBe(testGym.id);
    });

    it("should create member with trainer assignment", async () => {
      // Create a trainer
      const trainerUser = await prisma.user.create({
        data: { email: `trainer-${Date.now()}@test.com`, name: "Trainer", passwordHash: await hashPassword("pass") },
      });
      const trainer = await prisma.staffMember.create({
        data: { gymId: testGym.id, userId: trainerUser.id, role: "TRAINER", active: true },
      });

      const res = await client.post("/api/gym/members", {
        fullName: "Member With Trainer",
        trainerId: trainer.id,
      });
      const body = expectSuccess(res, 201);
      expect(body.member.trainerId).toBe(trainer.id);
    });

    it("should reject duplicate member code", async () => {
      const member = await prisma.member.create({
        data: testData.member(testGym.id, { memberCode: "DUPLICATE-CODE", fullName: "Original" }),
      });

      const res = await client.post("/api/gym/members", {
        fullName: "Duplicate",
        memberCode: "DUPLICATE-CODE",
      });
      expectError(res, 409, "member_code_exists");
    });

    it("should reject duplicate email in same gym", async () => {
      await prisma.member.create({
        data: testData.member(testGym.id, { email: "unique@test.com", fullName: "Original" }),
      });

      const res = await client.post("/api/gym/members", {
        fullName: "Duplicate",
        email: "unique@test.com",
      });
      expectError(res, 409, "email_exists");
    });
  });

  describe("GET /api/gym/members/:id", () => {
    let testMember: any;

    beforeAll(async () => {
      testMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "Detail Test Member" }),
      });
    });

    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.get(`/api/gym/members/${testMember.id}`);
      expectUnauthorized(res);
    });

    it("should return member details", async () => {
      const res = await client.get(`/api/gym/members/${testMember.id}`);
      const body = expectSuccess(res, 200);
      expect(body.member.id).toBe(testMember.id);
      expect(body.member.fullName).toBe("Detail Test Member");
      expect(body.member.attendanceStats).toBeDefined();
      expect(body.member.currentMembership).toBeDefined();
    });

    it("should return 404 for non-existent member", async () => {
      const res = await client.get("/api/gym/members/non-existent-id");
      expectError(res, 404, "not_found");
    });

    it("should return 404 for member in different gym", async () => {
      const otherGym = await prisma.gym.create({
        data: { name: "Other Gym", slug: "other-gym", email: "other@gym.com", city: "Kathmandu" },
      });
      const otherMember = await prisma.member.create({
        data: testData.member(otherGym.id, { fullName: "Other Gym Member" }),
      });

      const res = await client.get(`/api/gym/members/${otherMember.id}`);
      expectError(res, 404, "not_found");
    });
  });

  describe("PATCH /api/gym/members/:id", () => {
    let testMember: any;

    beforeAll(async () => {
      testMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "Update Test Member" }),
      });
    });

    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.patch(`/api/gym/members/${testMember.id}`, { fullName: "Updated" });
      expectUnauthorized(res);
    });

    it("should update member fields", async () => {
      const res = await client.patch(`/api/gym/members/${testMember.id}`, {
        fullName: "Updated Name",
        phone: "+977-9800000099",
        notes: "Updated notes",
      });
      const body = expectSuccess(res, 200);
      expect(body.member.fullName).toBe("Updated Name");
      expect(body.member.phone).toBe("+977-9800000099");
      expect(body.member.notes).toBe("Updated notes");
    });

    it("should update trainer assignment", async () => {
      const trainerUser = await prisma.user.create({
        data: { email: `trainer2-${Date.now()}@test.com`, name: "Trainer 2", passwordHash: await hashPassword("pass") },
      });
      const trainer = await prisma.staffMember.create({
        data: { gymId: testGym.id, userId: trainerUser.id, role: "TRAINER", active: true },
      });

      const res = await client.patch(`/api/gym/members/${testMember.id}`, {
        trainerId: trainer.id,
      });
      const body = expectSuccess(res, 200);
      expect(body.member.trainerId).toBe(trainer.id);
    });

    it("should remove trainer when set to null", async () => {
      const res = await client.patch(`/api/gym/members/${testMember.id}`, {
        trainerId: null,
      });
      const body = expectSuccess(res, 200);
      expect(body.member.trainerId).toBeNull();
    });

    it("should reject invalid email format", async () => {
      const res = await client.patch(`/api/gym/members/${testMember.id}`, { email: "invalid" });
      expectValidationError(res, "email");
    });

    it("should reject duplicate email", async () => {
      const otherMember = await prisma.member.create({
        data: testData.member(testGym.id, { email: "other@test.com", fullName: "Other" }),
      });

      const res = await client.patch(`/api/gym/members/${testMember.id}`, { email: "other@test.com" });
      expectError(res, 409, "email_exists");
    });
  });

  describe("DELETE /api/gym/members/:id", () => {
    let testMember: any;

    beforeAll(async () => {
      testMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "Delete Test Member" }),
      });
    });

    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.delete(`/api/gym/members/${testMember.id}`);
      expectUnauthorized(res);
    });

    it("should soft delete member (archive)", async () => {
      const res = await client.delete(`/api/gym/members/${testMember.id}`);
      const body = expectSuccess(res, 200);
      expect(body.success).toBe(true);

      const member = await prisma.member.findUnique({ where: { id: testMember.id } });
      expect(member?.archivedAt).not.toBeNull();
      expect(member?.status).toBe("ARCHIVED");
    });

    it("should return 404 for already deleted member", async () => {
      const res = await client.delete(`/api/gym/members/${testMember.id}`);
      expectError(res, 404, "not_found");
    });
  });

  describe("POST /api/gym/members/:id/invite", () => {
    let testMember: any;

    beforeAll(async () => {
      testMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "Invite Test Member", email: "invite@test.com" }),
      });
    });

    it("should require authentication", async () => {
      const freshClient = createTestClient(app);
      const res = await freshClient.post(`/api/gym/members/${testMember.id}/invite`, {});
      expectUnauthorized(res);
    });

    it("should send invite to member", async () => {
      const res = await client.post(`/api/gym/members/${testMember.id}/invite`, {
        role: "MEMBER",
      });
      const body = expectSuccess(res, 200);
      expect(body.invite).toBeDefined();
      expect(body.invite.token).toBeDefined();
      expect(body.invite.expiresAt).toBeDefined();
    });

    it("should reject invite for member without email", async () => {
      const noEmailMember = await prisma.member.create({
        data: testData.member(testGym.id, { fullName: "No Email", email: null }),
      });

      const res = await client.post(`/api/gym/members/${noEmailMember.id}/invite`, { role: "MEMBER" });
      expectError(res, 400, "no_email");
    });
  });
});