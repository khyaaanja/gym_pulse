import { prisma } from "@/db/client";
import type { ActorType } from "@/generated/prisma/enums";
import { log } from "./logger";

export type AuditActor = {
  type: ActorType;
  id?: string | null;
  name?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", name: "GymPulse" };

type AuditInput = {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  gymId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

const SECRET_KEYS = /pass(word)?|secret|token|credential|hash|mfa|apikey|key$/i;

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(v);
  return out;
}

/** Records a privileged action. Secrets are stripped from before/after snapshots. */
export async function audit(input: AuditInput, db: Pick<typeof prisma, "auditLog"> = prisma) {
  try {
    await db.auditLog.create({
      data: {
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        actorName: input.actor.name ?? null,
        actorRole: input.actor.role ?? null,
        ip: input.actor.ip ?? null,
        userAgent: input.actor.userAgent?.slice(0, 300) ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        gymId: input.gymId ?? null,
        before: (scrub(input.before) ?? undefined) as never,
        after: (scrub(input.after) ?? undefined) as never,
        metadata: (scrub(input.metadata) ?? undefined) as never,
      },
    });
  } catch (err) {
    log.error("audit.write_failed", { err, action: input.action });
    throw err;
  }
}

export async function securityEvent(input: {
  type: string;
  actorType: ActorType;
  userId?: string | null;
  adminId?: string | null;
  email?: string | null;
  gymId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}) {
  await prisma.securityEvent.create({
    data: { ...input, userAgent: input.userAgent?.slice(0, 300), details: (scrub(input.details) ?? undefined) as never },
  });
}
