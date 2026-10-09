import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TEMPLATES } from "@/services/notifications/templates";
import { verifyPassword } from "@/lib/auth/password";
import { bootstrapPlatform } from "../prisma/reference-data";

// Bootstrap targets an empty database, and the shared test schema is full of other files' fixtures. So this file
// builds its own schema from the migrations, exactly as a fresh production database would be.
const SCHEMA = "gympulse_bootstrap_test";
const url = process.env.DATABASE_URL!;
let db: PrismaClient;

const ADMIN = { adminEmail: "Owner@GymPulse.np", adminPassword: "correct-horse-battery-staple", supportEmail: "support@gympulse.np" };

beforeAll(async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.query(`CREATE SCHEMA "${SCHEMA}"`);
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    const dir = path.resolve("prisma/migrations");
    for (const m of readdirSync(dir).filter((d) => /^\d/.test(d)).sort()) await client.query(readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  } finally {
    await client.end();
  }
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 4, options: `-c TimeZone=UTC -c search_path=${SCHEMA},public` }, { schema: SCHEMA }) });
});

afterAll(async () => {
  await db?.$disconnect();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await client.end();
});

describe("production bootstrap", () => {
  it("rejects placeholder addresses and weak passwords before writing anything", async () => {
    await expect(bootstrapPlatform(db, { ...ADMIN, supportEmail: "support@gympulse.example" })).rejects.toThrow(/placeholder/);
    await expect(bootstrapPlatform(db, { ...ADMIN, adminEmail: "super@gympulse.local" })).rejects.toThrow(/placeholder/);
    await expect(bootstrapPlatform(db, { ...ADMIN, adminEmail: "owner@pulsefitness.demo" })).rejects.toThrow(/placeholder/);
    await expect(bootstrapPlatform(db, { ...ADMIN, adminEmail: "not-an-email" })).rejects.toThrow(/not an email/);
    await expect(bootstrapPlatform(db, { ...ADMIN, adminPassword: "short-pass1" })).rejects.toThrow(/16 characters/);
    await expect(bootstrapPlatform(db, { ...ADMIN, adminPassword: "password123" })).rejects.toThrow(/too common/);
    expect(await db.saasPlan.count()).toBe(0);
    expect(await db.platformAdmin.count()).toBe(0);
  });

  it("creates reference data and one super-admin who must reset the password and enrol MFA", async () => {
    const res = await bootstrapPlatform(db, ADMIN);
    expect(res).toEqual({ adminCreated: true, adminEmail: "owner@gympulse.np" });

    const admins = await db.platformAdmin.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ email: "owner@gympulse.np", role: "SUPER_ADMIN", mustResetPassword: true, mfaRequired: true, mfaEnabled: false });
    expect(await verifyPassword(admins[0]!.passwordHash, ADMIN.adminPassword)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "admins.bootstrapped", entityId: admins[0]!.id } })).toBe(1);

    expect((await db.saasPlan.findMany({ orderBy: { sortOrder: "asc" } })).map((p) => p.key)).toEqual(["starter", "growth", "pro"]);
    expect(await db.notificationTemplate.count({ where: { gymId: null } })).toBe(Object.keys(DEFAULT_TEMPLATES).length * 3);
    expect(await db.automationRule.count({ where: { gymId: null } })).toBe(7);
    expect(await db.predictionConfig.count({ where: { gymId: null } })).toBe(1);
    expect(await db.commissionRule.count()).toBe(2);
    expect(await db.contentEntry.count({ where: { section: "LEGAL" } })).toBeGreaterThan(0);
    expect((await db.platformSetting.findUnique({ where: { key: "platform.supportEmail" } }))?.value).toBe("support@gympulse.np");

    // Real providers only: the test gateway (members approve their own payments) must never reach production.
    expect((await db.paymentProviderConfig.findMany({ where: { gymId: null } })).map((p) => p.providerKey).sort()).toEqual(["esewa", "khalti"]);
    // Nothing demo-shaped.
    expect(await db.gym.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it("is idempotent and never overwrites what a super-admin edited", async () => {
    await db.saasPlan.update({ where: { key: "starter" }, data: { pricePaisa: 249_900 } });
    const flag = await db.featureFlag.findFirstOrThrow({ where: { key: "ocr_import", scope: "GLOBAL" } });
    await db.featureFlag.update({ where: { id: flag.id }, data: { enabled: false } });
    await db.platformSetting.update({ where: { key: "platform.supportEmail" }, data: { value: "help@gympulse.np" } });
    const counts = async () => Promise.all([db.saasPlan.count(), db.featureFlag.count(), db.notificationTemplate.count(), db.automationRule.count(), db.contentEntry.count(), db.marketplaceCategory.count(), db.commissionRule.count(), db.paymentProviderConfig.count()]);
    const before = await counts();

    const res = await bootstrapPlatform(db, { ...ADMIN, adminEmail: "someone-else@gympulse.np" });

    expect(res).toEqual({ adminCreated: false, adminEmail: null });
    expect(await db.platformAdmin.count()).toBe(1);
    expect(await counts()).toEqual(before);
    expect((await db.saasPlan.findUniqueOrThrow({ where: { key: "starter" } })).pricePaisa).toBe(249_900);
    expect((await db.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).enabled).toBe(false);
    expect((await db.platformSetting.findUnique({ where: { key: "platform.supportEmail" } }))?.value).toBe("help@gympulse.np");
  });
});
