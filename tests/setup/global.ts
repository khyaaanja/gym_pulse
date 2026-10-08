import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadTestEnv } from "./env";

/** Rebuilds the test schema from the migrations once per run. */
export default async function setup() {
  const { url, schema } = loadTestEnv();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Extensions (pg_trgm) live in public, so keep it on the path for operator classes.
    await client.query(`SET search_path TO "${schema}", public`);
    const dir = path.resolve("prisma/migrations");
    for (const m of readdirSync(dir).filter((d) => /^\d/.test(d)).sort()) {
      await client.query(readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }
}
