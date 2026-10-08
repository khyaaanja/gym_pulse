"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Flame, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Button } from "@/components/ui/button";

type R = { status: "accepted" | "duplicate"; streak?: number; newRewards?: string[]; warning?: string; message?: string };

export function SelfCheckIn({ token }: { token: string }) {
  const [state, setState] = useState<{ ok: boolean; r?: R; error?: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api<R>("/api/me/checkin", { body: { token } })
      .then((r) => setState({ ok: true, r }))
      .catch((e) => setState({ ok: false, error: e instanceof ApiError ? e.message : "Check-in failed." }));
  }, [token]);
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      {!state ? (
        <p className="text-ink-3">Checking you in…</p>
      ) : state.ok ? (
        <div>
          <CheckCircle2 className="mx-auto size-16 text-ok" aria-hidden />
          <h1 className="display mt-4 text-3xl font-semibold">{state.r?.status === "duplicate" ? "You're already checked in today" : "You're checked in"}</h1>
          {state.r?.streak ? <p className="mt-3 flex items-center justify-center gap-2 text-lg"><Flame className="size-5 text-warn" /> {state.r.streak}-day streak</p> : null}
          {state.r?.newRewards?.length ? <p className="mt-2 font-medium text-warn">Unlocked: {state.r.newRewards.join(", ")}</p> : null}
          {state.r?.warning && <p className="mt-3 text-sm text-ink-3">{state.r.warning}</p>}
          <Button asChild className="mt-8"><Link href="/app/attendance">See my attendance</Link></Button>
        </div>
      ) : (
        <div>
          <XCircle className="mx-auto size-16 text-risk" aria-hidden />
          <h1 className="display mt-4 text-2xl font-semibold">Couldn&apos;t check you in</h1>
          <p className="mt-2 text-ink-2">{state.error}</p>
          <Button asChild variant="secondary" className="mt-8"><Link href="/app/renew">Go to my membership</Link></Button>
        </div>
      )}
    </main>
  );
}
