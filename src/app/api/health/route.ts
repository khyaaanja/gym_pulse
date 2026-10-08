import { prisma } from "@/db/client";

/** Liveness + readiness for load balancers. Deliberately exposes no internals. */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", latencyMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
