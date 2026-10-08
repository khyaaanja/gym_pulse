"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "./button";
import { act, api } from "@/lib/client";

/** A button that calls one API endpoint, optionally after a confirmation, then refreshes. */
export function ActionButton({ endpoint, method = "POST", body, confirm, success, children, onDone, redirectTo, ...props }: ButtonProps & { endpoint: string; method?: string; body?: unknown; confirm?: string; success?: string; onDone?: (r: unknown) => void; redirectTo?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Button
      {...props}
      disabled={busy || props.disabled}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        const r = await act(() => api(endpoint, { method, body: body ?? (method === "GET" ? undefined : {}) }), success);
        setBusy(false);
        if (r !== null) {
          onDone?.(r);
          if (redirectTo) router.push(redirectTo);
          router.refresh();
        }
      }}
    >
      {children}
    </Button>
  );
}
