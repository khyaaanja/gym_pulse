/**
 * First-run setup for a real (staging/production) database: platform reference data and the first super-admin.
 * Safe to run again: reference data is written once, and a second super-admin is never created. A re-run needs none
 * of the variables below.
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
  // Each value is needed only on the run that uses it: the first run needs all three; later runs need none.
  const { BOOTSTRAP_ADMIN_EMAIL: adminEmail, BOOTSTRAP_ADMIN_PASSWORD: adminPassword, BOOTSTRAP_ADMIN_NAME: adminName, BOOTSTRAP_SUPPORT_EMAIL: supportEmail } = process.env;
  const res = await bootstrapPlatform(prisma, { adminEmail, adminPassword, adminName, supportEmail });
  console.log(res.referenceDataCreated ? "Platform reference data created." : "Platform reference data already in place; left unchanged.");
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
