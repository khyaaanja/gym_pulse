"use client";
import { useEffect, useState } from "react";
import { QrCode, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";

/** The member's rotating QR pass for the front desk to scan. */
export function MemberPass({ checkedIn }: { checkedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => api<{ qr: string }>("/api/me/pass").then((r) => alive && setQr(r.qr)).catch((e) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 240_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="h-auto flex-col gap-1 py-4">
          {checkedIn ? <CheckCircle2 /> : <QrCode />} {checkedIn ? "Checked in" : "My pass"}
        </Button>
      </DialogTrigger>
      <DialogContent title="Your check-in pass" description="Show this to the front desk. It refreshes every few minutes.">
        <div className="grid place-items-center py-4">
          {error ? <p className="text-sm text-risk">{error}</p> : qr ? <img src={qr} alt="Your personal check-in QR code" className="size-64 rounded-2xl bg-white p-3" /> : <div className="size-64 animate-pulse rounded-2xl bg-surface-2" />}
          <p className="mt-4 text-center text-sm text-ink-3">Or scan the QR code on the screen at reception with your phone camera.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
