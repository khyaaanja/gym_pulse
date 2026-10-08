import { CircleCheck, TriangleAlert, OctagonAlert, CircleMinus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "ok" | "warn" | "risk" | "lost";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  lost: "bg-lost-soft text-lost",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Member status: each has its own shape as well as colour, so it reads without colour vision. */
export const RISK_STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  ACTIVE: { label: "Active", tone: "ok", icon: CircleCheck },
  ATTENTION: { label: "Attention", tone: "warn", icon: TriangleAlert },
  AT_RISK: { label: "At Risk", tone: "risk", icon: OctagonAlert },
  LOST: { label: "Lost", tone: "lost", icon: CircleMinus },
};

export function RiskBadge({ status }: { status: string }) {
  const s = RISK_STATUS[status];
  if (!s) return <Badge>{status}</Badge>;
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className="-ml-0.5 size-3.5" strokeWidth={2.25} aria-hidden />
      {s.label}
    </Badge>
  );
}

const CATEGORY: Record<string, { label: string; tone: Tone }> = {
  LOW: { label: "Low risk", tone: "ok" },
  MODERATE: { label: "Moderate risk", tone: "warn" },
  HIGH: { label: "High risk", tone: "risk" },
  CRITICAL: { label: "Critical attention", tone: "risk" },
};

/** Estimated churn risk — always worded as an estimate. */
export function EstimateBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  const c = CATEGORY[category] ?? { label: category, tone: "neutral" as Tone };
  return (
    <Badge tone={c.tone} className={category === "CRITICAL" ? "ring-1 ring-risk/40" : undefined}>
      Est. {c.label.toLowerCase()}
    </Badge>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    SUCCEEDED: "ok", PAID: "ok", FULFILLED: "ok", IMPORTED: "ok", PUBLISHED: "ok", APPROVED: "ok", ACTIVE: "ok", CLEAN: "ok", SENT: "ok", RENEWED: "ok", RETURNED: "ok", COMPLETED: "ok", CONFIRMED: "ok", RESOLVED: "ok",
    PENDING: "warn", PENDING_PAYMENT: "warn", NEEDS_REVIEW: "warn", PROCESSING: "brand", IMPORTING: "brand", REVIEW: "warn", DRAFT: "neutral", TRIAL: "brand", TRIALING: "brand", QUEUED: "brand", FOLLOW_UP: "warn", CONTACTED: "brand", NOT_CONTACTED: "warn", OPEN: "warn", IN_PROGRESS: "brand", WAITING: "neutral", DUPLICATE: "warn", PENDING_APPROVAL: "warn",
    FAILED: "risk", SUSPENDED: "risk", PAST_DUE: "risk", REJECTED: "risk", INVALID: "risk", DEAD: "risk", LOST: "lost", CANCELLED: "lost", ARCHIVED: "lost", SKIPPED: "lost", EXPIRED: "lost", CLOSED: "lost",
  };
  return <Badge tone={map[status] ?? "neutral"}>{status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
