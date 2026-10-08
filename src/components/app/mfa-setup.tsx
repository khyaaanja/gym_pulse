"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { act, api } from "@/lib/client";

export function MfaSetup({ base = "/api/auth/mfa", done = "/app" }: { base?: string; done?: string }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const router = useRouter();
  if (!setup) return <Button onClick={async () => { const r = await act(() => api<{ qr: string; secret: string }>(`${base}/setup`, { body: {} })); if (r) setSetup(r); }}>Set up two-step verification</Button>;
  return (
    <div className="space-y-4">
      <img src={setup.qr} alt="Scan this QR code with your authenticator app" className="size-48 rounded-2xl bg-white p-2" />
      <p className="text-sm text-ink-3">Can&apos;t scan? Enter this key: <code className="break-all rounded bg-mist px-1.5 py-0.5">{setup.secret}</code></p>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" aria-label="6-digit code" className="max-w-40" />
        <Button onClick={async () => { const r = await act(() => api<{ redirect?: string }>(`${base}/enable`, { body: { code } }), "Two-step verification is on"); if (r) { router.push(r.redirect ?? done); router.refresh(); } }} disabled={code.length !== 6}>Turn on</Button>
      </div>
    </div>
  );
}
