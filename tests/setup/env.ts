import { config } from "dotenv";

/**
 * Tests run against an isolated schema inside DATABASE_URL's database (TEST_DB_SCHEMA, default
 * "gympulse_test"), so they never touch the app's `public` data and need no CREATEDB privilege.
 */
export function loadTestEnv() {
  config({ path: ".env", quiet: true });
  process.env.APP_ENV = "test";
  process.env.EMAIL_TRANSPORT = "console";
  process.env.RUN_WORKER_IN_PROCESS = "false";
  const schema = process.env.TEST_DB_SCHEMA ?? "gympulse_test";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || schema === "public") throw new Error(`Refusing to test against schema "${schema}"`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return { url: process.env.DATABASE_URL, schema };
}
