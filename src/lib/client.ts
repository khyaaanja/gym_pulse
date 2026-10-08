"use client";
import { toast } from "sonner";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[], public code?: string) {
    super(message);
  }
}

/** Browser → API helper. Errors come back as friendly messages from the server; raw errors never reach the UI. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    const setupPath = (err?.details as { path?: string } | undefined)?.path;
    if (res.status === 403 && err?.code === "account_setup_required" && setupPath?.startsWith("/") && typeof window !== "undefined") {
      window.location.href = setupPath;
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/")) {
      window.location.href = path.startsWith("/api/admin") ? "/super-admin/login" : "/login";
    }
    // Details are field-level validation messages only; other error codes carry them in other shapes.
    throw new ApiError(res.status, err?.message ?? "Something went wrong. Please try again.", Array.isArray(err?.details) ? (err.details as { path: string; message: string }[]) : undefined, err?.code);
  }
  return json as T;
}

/** Runs an API call with a toast for the outcome. Returns the result, or null on failure. */
export async function act<T>(fn: () => Promise<T>, success?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (success) toast.success(success);
    return r;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    return null;
  }
}
