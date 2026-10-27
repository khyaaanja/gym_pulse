import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { prisma } from "@/db/client";

// Test app setup - we'll create a minimal Express app that mounts our API routes
// This allows us to test routes in isolation without Next.js overhead

let testApp: express.Express;

export async function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Add request ID middleware
  app.use((req, _res, next) => {
    req.headers["x-request-id"] = req.headers["x-request-id"] || `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    next();
  });

  // Health check endpoint for testing
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  testApp = app;
  return app;
}

export function getTestApp() {
  if (!testApp) {
    throw new Error("Test app not initialized. Call createTestApp() first.");
  }
  return testApp;
}

// Test request helper with auth
export class TestClient {
  private app: express.Express;
  private cookies: string[] = [];

  constructor(app: express.Express) {
    this.app = app;
  }

  setCookies(cookies: string[]) {
    this.cookies = cookies;
  }

  private async request(method: string, path: string, data?: unknown, headers?: Record<string, string>) {
    const req = request(this.app)[method](path);

    if (this.cookies.length > 0) {
      req.set("Cookie", this.cookies.join("; "));
    }

    if (headers) {
      Object.entries(headers).forEach(([key, value]) => req.set(key, value));
    }

    if (data !== undefined) {
      req.send(data);
    }

    return req;
  }

  async get(path: string, headers?: Record<string, string>) {
    return this.request("get", path, undefined, headers);
  }

  async post(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.request("post", path, data, headers);
  }

  async put(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.request("put", path, data, headers);
  }

  async patch(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.request("patch", path, data, headers);
  }

  async delete(path: string, headers?: Record<string, string>) {
    return this.request("delete", path, undefined, headers);
  }
}

export function createTestClient(app: express.Express) {
  return new TestClient(app);
}

// Auth helpers
export async function loginAsOwner(client: TestClient, email = "owner@pulsefitness.demo", password = "GymPulse!Demo2026") {
  const res = await client.post("/api/auth/login", { identifier: email, password });
  if (res.status === 200 && res.headers["set-cookie"]) {
    client.setCookies(res.headers["set-cookie"]);
  }
  return res;
}

export async function loginAsSuperAdmin(client: TestClient, email = "admin@gympulse.demo", password = "SuperAdmin!2026") {
  const res = await client.post("/api/super-admin/login", { identifier: email, password });
  if (res.status === 200 && res.headers["set-cookie"]) {
    client.setCookies(res.headers["set-cookie"]);
  }
  return res;
}

export async function loginAsMember(client: TestClient, email: string, password: string) {
  const res = await client.post("/api/auth/login", { identifier: email, password });
  if (res.status === 200 && res.headers["set-cookie"]) {
    client.setCookies(res.headers["set-cookie"]);
  }
  return res;
}

// Database helpers for test isolation
export async function cleanupTestData() {
  // Delete in order of foreign key dependencies
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.paymentWebhookEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.member.deleteMany(),
    prisma.staffMember.deleteMany(),
    prisma.user.deleteMany(),
    prisma.gym.deleteMany(),
    prisma.platformAdmin.deleteMany(),
  ]);
}

export async function seedTestGym() {
  const gym = await prisma.gym.create({
    data: {
      name: "Test Gym",
      slug: `test-gym-${Date.now()}`,
      email: "test@gym.com",
      phone: "+977-1-1234567",
      city: "Kathmandu",
      timezone: "Asia/Kathmandu",
      currency: "NPR",
      currencySymbol: "Rs.",
      status: "ACTIVE",
      onboardingStep: 5,
      onboardedAt: new Date(),
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: `owner-${Date.now()}@test.com`,
      name: "Test Owner",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$test", // placeholder
    },
  });

  await prisma.staffMember.create({
    data: {
      gymId: gym.id,
      userId: owner.id,
      role: "OWNER",
      active: true,
    },
  });

  const plan = await prisma.membershipPlan.create({
    data: {
      gymId: gym.id,
      name: "Monthly",
      durationDays: 30,
      pricePaisa: 500000, // 5000 NPR
      active: true,
    },
  });

  return { gym, owner, plan };
}

// Response validation helpers
export function expectSuccess(res: request.Response, status = 200) {
  expect(res.status).toBe(status);
  expect(res.body).toBeDefined();
  return res.body;
}

export function expectError(res: request.Response, status: number, code?: string) {
  expect(res.status).toBe(status);
  expect(res.body).toBeDefined();
  expect(res.body.error).toBeDefined();
  if (code) {
    expect(res.body.code).toBe(code);
  }
  return res.body;
}

export function expectValidationError(res: request.Response, field?: string) {
  expect(res.status).toBe(400);
  expect(res.body.error).toBeDefined();
  if (field) {
    expect(res.body.details).toBeDefined();
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.some((d: any) => d.path.includes(field))).toBe(true);
  }
  return res.body;
}

export function expectUnauthorized(res: request.Response) {
  return expectError(res, 401, "unauthorized");
}

export function expectForbidden(res: request.Response) {
  return expectError(res, 403, "forbidden");
}

export function expectNotFound(res: request.Response) {
  return expectError(res, 404, "not_found");
}

export function expectRateLimited(res: request.Response) {
  return expectError(res, 429, "rate_limited");
}

// Schema validation helpers
export function expectValidResponse<T>(res: request.Response, schema: import("zod").ZodSchema<T>): T {
  const result = schema.safeParse(res.body);
  if (!result.success) {
    console.error("Response validation failed:", result.error.format());
    console.error("Response body:", JSON.stringify(res.body, null, 2));
  }
  expect(result.success).toBe(true);
  return result.data;
}

// Test data factories
export const testData = {
  member: (gymId: string, overrides = {}) => ({
    gymId,
    memberCode: `M${Date.now()}`,
    fullName: "Test Member",
    phone: "+977-9800000000",
    email: `member-${Date.now()}@test.com`,
    joinedOn: new Date(),
    status: "ACTIVE" as const,
    ...overrides,
  }),

  staff: (gymId: string, userId: string, role = "TRAINER", overrides = {}) => ({
    gymId,
    userId,
    role: role as any,
    active: true,
    grantedPermissions: [],
    revokedPermissions: [],
    ...overrides,
  }),

  membershipPlan: (gymId: string, overrides = {}) => ({
    gymId,
    name: "Test Plan",
    durationDays: 30,
    pricePaisa: 500000,
    active: true,
    ...overrides,
  }),

  payment: (gymId: string, memberId: string, overrides = {}) => ({
    gymId,
    memberId,
    purpose: "MEMBERSHIP" as const,
    method: "CASH" as const,
    provider: "manual",
    reference: `GP-T-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    amountPaisa: 500000,
    status: "PENDING" as const,
    ...overrides,
  }),

  product: (gymId: string, overrides = {}) => ({
    gymId,
    name: "Test Product",
    kind: "MERCH" as const,
    pricePaisa: 100000,
    status: "ACTIVE" as const,
    ...overrides,
  }),

  coupon: (gymId: string, overrides = {}) => ({
    gymId,
    code: `TEST${Date.now()}`,
    kind: "PERCENT" as const,
    value: 10,
    appliesTo: "ALL" as const,
    active: true,
    ...overrides,
  }),
};

// Mock helpers
export function mockPaymentProvider(providerKey: string, mockImpl: any) {
  return vi.hoisted(() => {
    const mock = vi.fn(mockImpl);
    return { mock };
  });
}

export function mockExternalService(serviceName: string, methods: Record<string, any>) {
  return vi.hoisted(() => {
    const mocks: Record<string, any> = {};
    Object.entries(methods).forEach(([key, impl]) => {
      mocks[key] = vi.fn(impl);
    });
    return { mocks };
  });
}

// Cleanup
export function registerCleanup(fn: () => Promise<void>) {
  afterAll(async () => {
    await fn();
  });
}