import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className, tone }: { name: string; className?: string; tone?: "risk" | "warn" | "ok" | "lost" }) {
  // Hue from the name so avatars are stable and distinguishable without photos.
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ring = tone ? { risk: "ring-risk", warn: "ring-warn", ok: "ring-ok", lost: "ring-lost" }[tone] : "ring-transparent";
  return (
    <span
      aria-hidden
      className={cn("inline-grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-semibold ring-2 ring-offset-2 ring-offset-surface", ring, className)}
      style={{ background: `oklch(0.93 0.05 ${h})`, color: `oklch(0.38 0.1 ${h})` }}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} />;
}

export function Progress({ value, max = 100, tone = "brand", className, label }: { value: number; max?: number; tone?: "brand" | "ok" | "warn" | "risk"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const bg = { brand: "bg-brand", ok: "bg-ok", warn: "bg-flame", risk: "bg-risk" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-300", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand [&_svg]:size-6">{icon}</div>}
      <h3 className="display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-[28px] font-extrabold leading-tight sm:text-[34px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Explicit marker for any number that is an estimate rather than a recorded fact. */
export function EstimateNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-relaxed text-ink-3", className)}>{children}</p>;
}
