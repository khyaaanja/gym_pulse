"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { act, api } from "@/lib/client";

export function SandboxDecision({ reference }: { reference: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const decide = async (decision: "approve" | "decline") => {
    setBusy(true);
    const r = await act(() => api<{ redirect: string }>(`/api/payments/sandbox/${encodeURIComponent(reference)}`, { body: { decision } }));
    setBusy(false);
    if (r) router.push(r.redirect);
  };
  return (
    <div className="mt-8 grid gap-2">
      <Button size="lg" disabled={busy} onClick={() => decide("approve")}>Approve payment</Button>
      <Button size="lg" variant="secondary" disabled={busy} onClick={() => decide("decline")}>Decline</Button>
    </div>
  );
}
