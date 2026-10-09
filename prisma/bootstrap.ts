/**
 * First-run setup for a real (staging/production) database: platform reference data and the first super-admin.
 * Safe to run again; it never overwrites edited data and never creates a second super-admin.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@your-domain BOOTSTRAP_ADMIN_PASSWORD='…' BOOTSTRAP_SUPPORT_EMAIL=support@your-domain \
 *     npm run db:bootstrap
 *
 * Remove BOOTSTRAP_ADMIN_PASSWORD from the environment afterwards. Demo data lives in prisma/seed.ts instead.
 */
import "dotenv/config";
import { prisma } from "@/db/client";
import { bootstrapPlatform } from "./reference-data";

async function main() {
  const { BOOTSTRAP_ADMIN_EMAIL: adminEmail, BOOTSTRAP_ADMIN_PASSWORD: adminPassword, BOOTSTRAP_ADMIN_NAME: adminName, BOOTSTRAP_SUPPORT_EMAIL: supportEmail } = process.env;
  if (!adminEmail || !adminPassword || !supportEmail) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_SUPPORT_EMAIL");
  }
  const res = await bootstrapPlatform(prisma, { adminEmail, adminPassword, adminName, supportEmail });
  console.log("Platform reference data is in place.");
  console.log(res.adminCreated
    ? `Created super-admin ${res.adminEmail}. Sign in at /super-admin/login; you will be asked to set a new password and enrol MFA.`
    : "A super-admin already exists; none created.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
