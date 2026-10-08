"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { Button } from "./button";
import { Field, Input, Select, Textarea } from "./fields";
import { api, ApiError } from "@/lib/client";
import { uuid } from "@/lib/uuid";
import { toast } from "sonner";
import { TRANSFORMS, type TransformKey } from "./transforms";

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "password" | "select" | "textarea" | "checkbox" | "date" | "datetime" | "tel" | "list";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean | null;
  step?: string;
};

/**
 * Spec-driven form in a dialog: renders fields, posts JSON, shows server validation messages,
 * refreshes the page on success. Used across settings and the control center.
 */
export function FormDialog({
  trigger, title, description, fields, endpoint, method = "POST", submitLabel = "Save", transform, transformArgs, onDone, successMessage, idempotent,
}: {
  trigger: React.ReactNode; title: string; description?: string; fields: FieldSpec[]; endpoint: string; method?: string; submitLabel?: string;
  /** Named transform (see ./transforms) — functions can't cross the server→client boundary. */
  transform?: TransformKey; transformArgs?: Record<string, unknown>;
  /** Only usable from client components. */
  onDone?: (res: unknown) => void; successMessage?: string;
  /**
   * For forms that move money: each opening of the dialog sends one `idempotencyKey`, so a double-click or a retry
   * after a timeout can't record twice. A `duplicate_payment` reply asks staff to confirm before sending again.
   */
  idempotent?: boolean;
}) {
  const [open, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => uuid());
  const router = useRouter();
  const setOpen = (next: boolean) => {
    if (next && !open) setIdempotencyKey(uuid());
    setOpenState(next);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = fd.get(f.name);
      if (f.type === "checkbox") values[f.name] = raw === "on";
      else if (f.type === "number") values[f.name] = raw === "" || raw === null ? null : Number(raw);
      else if (f.type === "datetime" || f.type === "date") values[f.name] = raw ? new Date(String(raw)).toISOString() : null;
      else if (f.type === "list") values[f.name] = String(raw ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      else values[f.name] = raw === "" ? (f.required ? "" : null) : raw;
    }
    setBusy(true);
    setErrors({});
    try {
      const body = { ...(transform ? TRANSFORMS[transform](values, transformArgs ?? {}) : values), ...(idempotent ? { idempotencyKey } : {}) };
      let res: unknown;
      try {
        res = await api(endpoint, { method, body });
      } catch (err) {
        if (!(idempotent && err instanceof ApiError && err.code === "duplicate_payment")) throw err;
        if (!window.confirm(`${err.message}\n\nRecord this payment anyway?`)) return;
        res = await api(endpoint, { method, body: { ...body, idempotencyKey: uuid(), confirmDuplicate: true } });
      }
      toast.success(successMessage ?? "Saved");
      setOpen(false);
      onDone?.(res);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path.split(".").at(-1) ?? d.path, d.message])));
      }
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} className="space-y-4">
          {fields.map((f) => {
            const id = `f-${f.name}`;
            const dv = f.defaultValue === null || f.defaultValue === undefined ? undefined : String(f.defaultValue);
            if (f.type === "checkbox") {
              return (
                <label key={f.name} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-sm font-medium">
                  <input type="checkbox" name={f.name} defaultChecked={!!f.defaultValue} className="size-4 accent-[var(--brand)]" />
                  {f.label}
                </label>
              );
            }
            return (
              <Field key={f.name} label={f.label} hint={f.hint} error={errors[f.name]} htmlFor={id}>
                {f.type === "select" ? (
                  <Select id={id} name={f.name} defaultValue={dv} required={f.required}>
                    {!f.required && <option value="">—</option>}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                ) : f.type === "textarea" || f.type === "list" ? (
                  <Textarea id={id} name={f.name} defaultValue={dv} required={f.required} placeholder={f.placeholder} />
                ) : (
                  <Input
                    id={id}
                    name={f.name}
                    type={f.type === "datetime" ? "datetime-local" : f.type ?? "text"}
                    step={f.step ?? (f.type === "number" ? "any" : undefined)}
                    defaultValue={dv}
                    required={f.required}
                    placeholder={f.placeholder}
                    autoComplete={f.type === "password" ? "new-password" : undefined}
                  />
                )}
              </Field>
            );
          })}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
