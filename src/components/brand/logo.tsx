import Link from "next/link";

/** The mark: a heartbeat whose spike is a Himalayan summit, with the pulse's bright head at the top. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="10" fill="var(--deep)" />
      <path d="M4 21h5.5l2.2-3.2 3.6-9.3 3.9 12.7 2.3-4.1 1.6 3.9H28" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="15.3" cy="8.5" r="2.6" fill="var(--brand)" stroke="var(--deep)" strokeWidth="1.2" />
    </svg>
  );
}

export function Logo({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`} aria-label="GymPulse home">
      <LogoMark />
      <span className="display text-xl font-bold tracking-tight">GymPulse</span>
    </Link>
  );
}
