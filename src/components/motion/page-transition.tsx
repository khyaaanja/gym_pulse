"use client";
import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

/**
 * Swings the outgoing page away and the incoming one in, in 3D, on every navigation. Renders no DOM of its own.
 * `scope="area"` (root layout) keys by app area, so the app shell and admin console stay mounted while their own
 * PageTransition, around the shell's content, animates each page. Updates within a page (refreshes, search
 * params, Suspense reveals) don't animate. Browsers without the View Transitions API just swap pages as before.
 */
export function PageTransition({ children, scope = "page" }: { children: React.ReactNode; scope?: "page" | "area" }) {
  const pathname = usePathname();
  const key = scope === "area" ? areaOf(pathname) : pathname;
  return (
    <ViewTransition key={key} enter="page-3d" exit="page-3d" default="none">
      {children}
    </ViewTransition>
  );
}

function areaOf(path: string) {
  if (path === "/app" || path.startsWith("/app/")) return "app";
  if (path.startsWith("/super-admin") && !path.startsWith("/super-admin/login")) return "super-admin";
  return path;
}
