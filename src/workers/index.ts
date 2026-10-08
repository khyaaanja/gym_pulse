// Standalone worker process: `npm run worker`
import "dotenv/config";
import { env } from "@/config/env";
import { startWorker, stopWorker } from "./runner";

env();
startWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopWorker();
    setTimeout(() => process.exit(0), 1500);
  });
}
