"use client";
import { useLinkStatus } from "next/link";

/**
 * Feedback while a nav link's page is on its way (pages have no loading skeleton, so nothing else changes until it
 * arrives). Always rendered at a fixed size and only its opacity animates, so it neither shifts layout nor leaves the
 * compositor; it fades in after a beat, so a quick navigation never flashes it.
 */
export function PendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden data-pending={pending || undefined} className="nav-pending pointer-events-none absolute inset-0 rounded-[inherit] bg-current/10" />;
}
