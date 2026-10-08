import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = adminRoute({ permission: "system.manage" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ status: z.enum(["DEAD", "FAILED", "PENDING", "RUNNING", "SUCCEEDED", "ALL"]).default("DEAD") }));
  const [jobs, counts] = await Promise.all([
    prisma.job.findMany({ where: q.status === "ALL" ? {} : { status: q.status }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, type: true, gymId: true, status: true, attempts: true, maxAttempts: true, runAt: true, lastError: true, createdAt: true, finishedAt: true, durationMs: true } }),
    prisma.job.groupBy({ by: ["status"], _count: true }),
  ]);
  return { jobs: jobs.map((j) => ({ ...j, lastError: j.lastError?.trimStart().split("\n")[0] ?? null })), counts };
});
