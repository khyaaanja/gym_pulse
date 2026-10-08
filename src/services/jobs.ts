import { prisma } from "@/db/client";
import { Prisma, type Job } from "@/generated/prisma/client";
import { log } from "@/lib/logger";

export type EnqueueOptions = {
  gymId?: string | null;
  runAt?: Date;
  delayMs?: number;
  priority?: number;
  maxAttempts?: number;
  /** Same key → the job is enqueued at most once (ever). Use a period in the key for recurring work. */
  idempotencyKey?: string;
};

export async function enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<Job | null> {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  if (opts.idempotencyKey) {
    const existing = await prisma.job.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return null;
  }
  try {
    return await prisma.job.create({
      data: {
        type,
        payload: payload as never,
        gymId: opts.gymId ?? null,
        runAt,
        priority: opts.priority ?? 0,
        maxAttempts: opts.maxAttempts ?? 5,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // raced with another enqueuer
    throw err;
  }
}

/** Atomically claims the next runnable job. Concurrent workers never receive the same row. */
export async function claimNext(workerId: string, types?: string[]): Promise<Job | null> {
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ${types?.length ? prismaTypes(types) : emptySql()}
      ORDER BY "priority" DESC, "runAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

// Small helpers so the optional filter composes as a SQL fragment.
function prismaTypes(types: string[]) {
  return Prisma.sql`AND "type" IN (${Prisma.join(types)})`;
}
function emptySql() {
  return Prisma.empty;
}

export async function completeJob(job: Job, result: unknown, durationMs: number) {
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "SUCCEEDED", finishedAt: new Date(), lockedAt: null, result: (result ?? undefined) as never, durationMs, lastError: null },
  });
}

/** Exponential backoff with jitter: 30s, 1m, 2m, 4m… capped at 1h. Exhausted jobs are dead-lettered. */
export function backoffMs(attempt: number): number {
  const base = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 0.2 * base);
}

export async function failJob(job: Job, err: unknown, durationMs: number) {
  const message = err instanceof Error ? `${err.message.trim()}\n${err.stack ?? ""}`.slice(0, 4000) : String(err).slice(0, 4000);
  const permanent = (err as { permanent?: boolean })?.permanent === true;
  const dead = permanent || job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: dead ? "DEAD" : "PENDING",
      runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      durationMs,
      finishedAt: dead ? new Date() : null,
    },
  });
  log[dead ? "error" : "warn"](dead ? "job.dead_lettered" : "job.retry_scheduled", { jobId: job.id, type: job.type, attempts: job.attempts, error: message.split("\n")[0] });
}

/** Jobs stuck in RUNNING (worker crashed) go back to the queue. */
export async function reclaimStale(timeoutMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - timeoutMs);
  const res = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null, lastError: "Reclaimed after worker timeout" },
  });
  return res.count;
}

/** Manual retry from the control center (dead or failed jobs). */
export async function retryJob(id: string) {
  return prisma.job.update({
    where: { id },
    data: { status: "PENDING", runAt: new Date(), attempts: 0, lockedAt: null, lockedBy: null, finishedAt: null },
  });
}

/** Marks a failure as non-retryable (bad input) so it dead-letters immediately. */
export class PermanentJobError extends Error {
  permanent = true;
}
