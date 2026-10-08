"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";

type Pref = { category: string; channel: string; enabled: boolean };
const LABEL: Record<string, string> = { AT_RISK: "At-risk alerts", RENEWAL: "Renewals", PAYMENT: "Payments", MARKETPLACE: "Marketplace", MILESTONE: "Milestones", INACTIVITY: "We miss you", BOOKING: "Bookings", SYSTEM: "System", IN_APP: "App", PUSH: "Push", SMS: "SMS", EMAIL: "Email", WHATSAPP: "WhatsApp" };

export function Preferences() {
  const [data, setData] = useState<{ categories: string[]; channels: string[]; preferences: Pref[] } | null>(null);
  useEffect(() => { api<typeof data>("/api/notifications/preferences").then(setData).catch(() => undefined); }, []);
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" />;
  const toggle = async (p: Pref) => {
    const next = { ...p, enabled: !p.enabled };
    setData({ ...data, preferences: data.preferences.map((x) => (x.category === p.category && x.channel === p.channel ? next : x)) });
    await api("/api/notifications/preferences", { method: "PUT", body: { preferences: [next] } }).catch(() => toast.error("Couldn't save that preference."));
  };
  return (
    <div className="relative -mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[420px] text-sm">
        <thead><tr><th className="pb-2 text-left font-medium text-ink-3">Update</th>{data.channels.map((c) => <th key={c} className="pb-2 text-center font-medium text-ink-3">{LABEL[c]}</th>)}</tr></thead>
        <tbody>
          {data.categories.map((cat) => (
            <tr key={cat} className="border-t border-line">
              <td className="py-2.5">{LABEL[cat] ?? cat}</td>
              {data.channels.map((ch) => {
                const p = data.preferences.find((x) => x.category === cat && x.channel === ch)!;
                return <td key={ch} className="text-center"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={p.enabled} onChange={() => toggle(p)} aria-label={`${LABEL[cat]} by ${LABEL[ch]}`} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
