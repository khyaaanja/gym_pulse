"use client";
import { useRouter } from "next/navigation";
import { act, api } from "@/lib/client";
import { Select } from "@/components/ui/fields";

/** Tri-state: inherit (clear override), on, off. */
export function FlagToggle({ flag, scope, scopeId, value, overridden, disabled }: { flag: string; scope: "GLOBAL" | "PLAN" | "GYM"; scopeId: string; value: boolean; overridden: boolean; disabled?: boolean }) {
  const router = useRouter();
  return (
    <Select
      aria-label={`${flag} for ${scope.toLowerCase()}`}
      className="h-9 w-36 text-sm"
      disabled={disabled}
      value={overridden ? (value ? "on" : "off") : "inherit"}
      onChange={async (e) => {
        const v = e.target.value;
        const r = await act(() => api("/api/admin/flags", { method: "PUT", body: { key: flag, scope, scopeId, enabled: v === "inherit" ? null : v === "on" } }), "Feature updated");
        if (r) router.refresh();
      }}
    >
      <option value="inherit">Inherit ({value ? "on" : "off"})</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </Select>
  );
}
