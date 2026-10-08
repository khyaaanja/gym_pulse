import { prisma } from "@/db/client";
import { tooMany } from "./errors";

/**
 * Fixed-window counter stored in Postgres so limits hold across processes.
 * Returns the count in the current window; throws 429 when over `limit`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) throw tooMany();
  return count;
}

export async function resetRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
