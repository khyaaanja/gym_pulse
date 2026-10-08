"use client";
import { useState } from "react";
import { Smartphone, Copy } from "lucide-react";
import { copyText } from "./copy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { act, api } from "@/lib/client";

type Res = { link: string; delivery: { channel: string; status: string; error: string | null }[] };

/** Sends an app invite. The link is also shown so staff can share it directly if SMS/email isn't set up. */
export function InviteButton({ memberId }: { memberId: string }) {
  const [res, setRes] = useState<Res | null>(null);
  return (
    <>
      <Button variant="secondary" onClick={async () => { const r = await act(() => api<Res>(`/api/gym/members/${memberId}/invite`, { body: {} })); if (r) setRes(r); }}><Smartphone /> Invite to app</Button>
      <Dialog open={!!res} onOpenChange={(o) => !o && setRes(null)}>
        {res && (
          <DialogContent title="Invite created" description="Valid for 7 days.">
            <ul className="space-y-1 text-sm">
              {res.delivery.map((d) => <li key={d.channel}>{d.channel}: {d.status === "SKIPPED" || d.status === "FAILED" ? `not sent (${d.error})` : "on its way"}</li>)}
              {res.delivery.length === 0 && <li>No message was sent.</li>}
            </ul>
            <p className="mt-4 text-sm text-ink-2">You can also share this link with the member directly:</p>
            <div className="mt-2 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-mist px-3 py-2.5 text-xs">{res.link}</code>
              <Button size="sm" variant="secondary" aria-label="Copy link" onClick={() => void copyText(res.link, "Link copied")}><Copy /></Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
