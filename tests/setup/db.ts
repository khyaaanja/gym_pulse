import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadTestEnv } from "./env";

// Bind the app's shared client (src/db/client.ts reuses globalThis.__gympulsePrisma) to the test schema
// before any service module creates its own. search_path matters too: raw SQL in the services uses unqualified
// table names, which would otherwise resolve to `public`.
const { url, schema } = loadTestEnv();
const adapter = new PrismaPg({ connectionString: url, max: 20, options: `-c TimeZone=UTC -c search_path=${schema},public` }, { schema });
globalThis.__gympulsePrisma = new PrismaClient({ adapter });
