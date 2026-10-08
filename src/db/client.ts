import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

declare global {
  var __gympulsePrisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // DateTime columns are `timestamp without time zone` holding UTC. Raw SQL compares them with now(), which
  // Postgres renders in the session time zone — so every connection must run in UTC, whatever the server's
  // default. (A server set to America/New_York otherwise delays every job by four hours and skews rate limits.)
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 10), options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter });
}

/**
 * The dev-mode cache survives hot reloads, so after `prisma generate` adds a model a client created before it lacks
 * that delegate (`db.lead` is undefined → page crash). Reuse the cache only if it has every current model. Checked
 * by shape, not class identity: the test setup and each Turbopack layer evaluate the generated client separately,
 * and their clients must still be shared. A stale client is left alone, not disconnected — another layer may be
 * mid-query on it.
 */
export function isCurrent(c: unknown): c is PrismaClient {
  if (!c) return false;
  return Object.values(Prisma.ModelName).every((m) => (c as Record<string, unknown>)[m.charAt(0).toLowerCase() + m.slice(1)] !== undefined);
}

/** Unscoped client. Only services that are platform-level, or that scope queries explicitly, may use this directly. */
export const prisma: PrismaClient = isCurrent(globalThis.__gympulsePrisma) ? globalThis.__gympulsePrisma : create();
if (process.env.NODE_ENV !== "production") globalThis.__gympulsePrisma = prisma;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
