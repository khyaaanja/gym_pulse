export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/config/env");
  env(); // fail fast on bad configuration
  if (process.env.RUN_WORKER_IN_PROCESS === "true") {
    const { startWorker } = await import("@/workers/runner");
    startWorker({ concurrency: 2 });
  }
}
