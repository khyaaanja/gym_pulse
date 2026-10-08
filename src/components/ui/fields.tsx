import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const base = "w-full rounded-xl bg-surface px-3.5 text-[15px] text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-11", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-24 py-2.5", className)} {...p} />;
}

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(base, "h-11 appearance-none pr-9", className)} {...p}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="field-error text-sm text-risk">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
