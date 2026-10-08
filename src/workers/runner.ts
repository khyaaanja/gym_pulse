import os from "node:os";
import { prisma } from "@/db/client";
import { claimNext, completeJob, enqueue, failJob, reclaimStale } from "@/services/jobs";
import { log } from "@/lib/logger";
import { HANDLERS, onDeadLetter } from "./handlers";

/**
 * Recurring schedule. Each tick enqueues with a period-scoped idempotency key, so any number of
 * workers can run the scheduler without duplicating work.
 */
async function schedule(now = new Date()) {
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  await enqueue("fanout.hourly", {}, { idempotencyKey: `fanout.hourly:${hour}` });
  // Daily work runs after 00:15 UTC (~06:00 Nepal time) so reminders don't go out at night.
  await enqueue("fanout.daily", {}, { idempotencyKey: `fanout.daily:${day}`, runAt: new Date(`${day}T00:15:00.000Z`) });
  await enqueue("fanout.weekly", {}, { idempotencyKey: `fanout.weekly:${week}` });
  await enqueue("billing.subscriptions", {}, { idempotencyKey: `billing:${day}` });
  await enqueue("prediction.evaluate", {}, { idempotencyKey: `prediction.evaluate:${day}` });
  await enqueue("maintenance.cleanup", {}, { idempotencyKey: `cleanup:${hour}` });
}

export async function runOne(workerId: string): Promise<boolean> {
  const job = await claimNext(workerId);
  if (!job) return false;
  const started = Date.now();
  const handler = HANDLERS[job.type];
  try {
    if (!handler) throw Object.assign(new Error(`No handler for job type ${job.type}`), { permanent: true });
    const result = await handler(job.payload as Record<string, unknown>, job);
    await completeJob(job, result, Date.now() - started);
  } catch (err) {
    await failJob(job, err, Date.now() - started);
    const after = await prisma.job.findUnique({ where: { id: job.id } });
    if (after?.status === "DEAD") await onDeadLetter(after).catch((e) => log.error("job.dead_letter_hook_failed", { err: e }));
  }
  return true;
}

let running = false;

export function startWorker(opts: { concurrency?: number; pollMs?: number } = {}) {
  if (running) return;
  running = true;
  const workerId = `${os.hostname()}:${process.pid}`;
  const concurrency = opts.concurrency ?? 2;
  const pollMs = opts.pollMs ?? 2000;
  log.info("worker.started", { workerId, concurrency });

  const loop = async (slot: number) => {
    while (running) {
      try {
        const worked = await runOne(`${workerId}#${slot}`);
        if (!worked) await new Promise((r) => setTimeout(r, pollMs));
      } catch (err) {
        log.error("worker.loop_error", { err });
        await new Promise((r) => setTimeout(r, pollMs * 5));
      }
    }
  };
  for (let i = 0; i < concurrency; i++) void loop(i);

  const tick = async () => {
    try {
      await schedule();
      await reclaimStale();
    } catch (err) {
      log.error("worker.schedule_error", { err });
    }
  };
  void tick();
  setInterval(tick, 60_000).unref();
}

export function stopWorker() {
  running = false;
}
