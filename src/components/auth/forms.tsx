"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/fields";
import { api, ApiError } from "@/lib/client";
import { safeNext } from "@/lib/safe-next";

type Spec = { name: string; label: string; type?: string; autoComplete?: string; hint?: string; required?: boolean; inputMode?: "numeric" | "email" | "tel" };

/** Generic auth form: posts the fields as JSON and follows the `redirect` the server returns. */
export function AuthForm({ endpoint, fields, submit, extra, onSuccessMessage, fallbackRedirect, next }: { endpoint: string; fields: Spec[]; submit: string; extra?: Record<string, string>; onSuccessMessage?: string; fallbackRedirect?: string; next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const body = Object.fromEntries(new FormData(e.currentTarget).entries());
        try {
          const res = await api<{ redirect?: string; message?: string }>(endpoint, { body: { ...body, ...extra } });
          if (onSuccessMessage || res?.message) {
            setDone(res?.message ?? onSuccessMessage!);
            toast.success(res?.message ?? onSuccessMessage!);
          }
          // Only same-site relative paths are honoured for ?next= (no open redirects).
          const safe = safeNext(next);
          const to = res?.redirect === "/app" && safe ? safe : res?.redirect ?? fallbackRedirect;
          if (to) {
            router.push(to);
            router.refresh();
          }
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint} htmlFor={f.name}>
          <Input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required={f.required ?? true} inputMode={f.inputMode} />
        </Field>
      ))}
      {error && <p role="alert" className="rounded-xl bg-risk-soft px-3.5 py-2.5 text-sm text-risk">{error}</p>}
      {done && <p role="status" className="rounded-xl bg-ok-soft px-3.5 py-2.5 text-sm text-ok">{done}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : submit}</Button>
    </form>
  );
}
