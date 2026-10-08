"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { api, ApiError } from "@/lib/client";
import { cn } from "@/lib/utils";

export type PublicField = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "password" | "date" | "select" | "textarea" | "radio";
  required?: boolean;
  hint?: string;
  autoComplete?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string; detail?: string }[];
};

/**
 * Form for the public gym pages: posts JSON, shows the server's message or follows its redirect, and puts
 * validation errors next to the field they belong to. Includes a hidden honeypot field for bots.
 */
export function PublicForm({ endpoint, fields, submit, hidden, signInHref, className }: { endpoint: string; fields: PublicField[]; submit: string; hidden?: Record<string, string | null | undefined>; signInHref?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  if (done) return <p role="status" className="rounded-2xl bg-ok-soft p-5 text-[15px] font-medium text-ok">{done}</p>;

  return (
    <form
      className={cn("space-y-4", className)}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setFieldErrors({});
        const body = { ...Object.fromEntries(Object.entries(hidden ?? {}).filter(([, v]) => v)), ...Object.fromEntries(new FormData(e.currentTarget).entries()) };
        try {
          const res = await api<{ redirect?: string; message?: string }>(endpoint, { body });
          if (res?.redirect) {
            router.push(res.redirect);
            router.refresh();
          } else setDone(res?.message ?? "Thanks — we got it.");
        } catch (err) {
          if (err instanceof ApiError) {
            setError({ message: err.message, code: err.code });
            if (err.details) setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
          } else setError({ message: "Something went wrong. Please try again." });
        } finally {
          setBusy(false);
        }
      }}
    >
      {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {fields.map((f) =>
        f.type === "radio" ? (
          <fieldset key={f.name}>
            <legend className="mb-2 text-sm font-medium text-ink-2">{f.label}</legend>
            <div className="grid gap-2">
              {f.options?.map((o, i) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line has-[:checked]:bg-brand-soft has-[:checked]:ring-brand">
                  <input type="radio" name={f.name} value={o.value} defaultChecked={f.defaultValue ? f.defaultValue === o.value : i === 0} className="accent-[var(--brand)]" />
                  <span className="flex-1 font-medium">{o.label}</span>
                  {o.detail && <span className="num text-sm text-ink-2">{o.detail}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <Field key={f.name} label={f.label} hint={f.hint} error={fieldErrors[f.name]} htmlFor={`pf-${f.name}`}>
            {f.type === "select" ? (
              <Select id={`pf-${f.name}`} name={f.name} required={f.required} defaultValue={f.defaultValue ?? ""}>
                {!f.required && <option value="">—</option>}
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea id={`pf-${f.name}`} name={f.name} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} rows={3} />
            ) : (
              <Input id={`pf-${f.name}`} name={f.name} type={f.type ?? "text"} required={f.required} autoComplete={f.autoComplete} placeholder={f.placeholder} defaultValue={f.defaultValue} />
            )}
          </Field>
        ),
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
          {error.message}
          {error.code === "sign_in_required" && signInHref && <> <a className="font-semibold underline" href={signInHref}>Sign in</a></>}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : submit}</Button>
    </form>
  );
}
