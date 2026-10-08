import { Skeleton } from "@/components/ui/misc";

/**
 * The shape of a page while its data renders on the server: a title, a row of cards and a list. Shown by the route
 * `loading.tsx` files, which also let Next prefetch the shell of every dynamic page, so a click changes the screen
 * at once instead of waiting on the server with nothing happening.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
