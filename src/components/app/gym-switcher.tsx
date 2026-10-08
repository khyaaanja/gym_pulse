"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { act, api } from "@/lib/client";
import { cn } from "@/lib/utils";

/** For people who work at, or train at, more than one gym. Switching changes the session's active gym. */
export function GymSwitcher({ gyms, current, className }: { gyms: { id: string; name: string; role: string }[]; current: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (gyms.length < 2) return null;
  return (
    <label className={cn("relative flex items-center", className)}>
      <span className="sr-only">Switch gym</span>
      <select
        value={current}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          const r = await act(() => api("/api/auth/switch-gym", { body: { gymId: e.target.value } }), "Switched gym");
          setBusy(false);
          if (r !== null) {
            router.push("/app");
            router.refresh();
          }
        }}
        className="h-9 w-full appearance-none truncate rounded-xl bg-surface-2 pl-3 pr-8 text-sm font-medium text-ink ring-1 ring-line"
      >
        {gyms.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.role}</option>)}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 size-4 text-ink-3" aria-hidden />
    </label>
  );
}
