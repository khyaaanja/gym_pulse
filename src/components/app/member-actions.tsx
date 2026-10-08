"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Phone, Send, NotebookPen, CheckCircle2, XCircle, HeartHandshake, MoreHorizontal } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { act, api } from "@/lib/client";

type Props = {
  memberId: string;
  fullName: string;
  phone: string | null;
  gymName: string;
  staffName: string;
  taskId: string | null;
  canMessage: boolean;
  compact?: boolean;
};

const TEMPLATES = (first: string, gym: string, staff: string) => ({
  checkin: `Hi ${first}, this is ${staff} from ${gym}. We noticed we haven't seen you in a while — is there anything we can help with? Reply anytime.`,
  renew: `Hi ${first}, your membership at ${gym} is coming up for renewal. You can renew in the GymPulse app in a few taps. Let us know if you have questions.`,
  comeback: `Hi ${first}, we'd love to see you back at ${gym}. Your trainer can set up a lighter session to ease back in — just reply to book a time.`,
});

async function ensureTask(memberId: string, taskId: string | null) {
  if (taskId) return taskId;
  const r = await api<{ task: { id: string } }>("/api/gym/recovery", { body: { memberId } });
  return r.task.id;
}

export function MemberActions(p: Props) {
  const router = useRouter();
  const first = p.fullName.split(" ")[0]!;
  const t = useMemo(() => TEMPLATES(first, p.gymName, p.staffName.split(" ")[0]!), [first, p.gymName, p.staffName]);
  const [msgOpen, setMsgOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [template, setTemplate] = useState<keyof typeof t>("checkin");
  const [body, setBody] = useState(t.checkin);
  const [channel, setChannel] = useState("SMS");
  const [busy, setBusy] = useState(false);
  const wa = p.phone && /^9[678]\d{8}$/.test(p.phone) ? `https://wa.me/977${p.phone}?text=${encodeURIComponent(body)}` : null;

  const logContact = async (method: string, extra: Record<string, unknown> = {}) => {
    const id = await ensureTask(p.memberId, p.taskId);
    return api(`/api/gym/recovery/${id}`, { body: { action: "contact", method, ...extra } });
  };

  const markReturned = async () => {
    const r = await act(() => api(`/api/gym/recovery/${p.taskId}`, { body: { action: "returned" } }), "Marked as returned");
    if (r) router.refresh();
  };
  const markLost = async () => {
    const r = await act(() => api(`/api/gym/recovery/${p.taskId}`, { body: { action: "lost" } }), "Marked as lost");
    if (r) { setLostOpen(false); router.refresh(); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.phone && (
        <Button asChild variant="secondary" size="sm" onClick={() => void act(() => logContact("CALL", { result: "Called" })).then(() => router.refresh())}>
          <a href={`tel:${p.phone}`}><Phone /> Call</a>
        </Button>
      )}
      {wa && (
        <Button asChild variant="secondary" size="sm" onClick={() => void act(() => logContact("WHATSAPP", { result: "WhatsApp opened" })).then(() => router.refresh())}>
          <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a>
        </Button>
      )}
      {p.canMessage && (
        <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm"><Send /> Message</Button>
          </DialogTrigger>
          <DialogContent title={`Message ${first}`} description="Choose a message, check the preview, then send.">
            <div className="space-y-4">
              <Field label="Message">
                <Select value={template} onChange={(e) => { const k = e.target.value as keyof typeof t; setTemplate(k); setBody(t[k]); }}>
                  <option value="checkin">Friendly check-in</option>
                  <option value="renew">Renewal reminder</option>
                  <option value="comeback">Welcome back</option>
                </Select>
              </Field>
              <Field label="Preview" hint={`${body.length}/640 characters`}>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={640} rows={5} />
              </Field>
              <Field label="Send by">
                <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="SMS">SMS</option>
                  <option value="IN_APP">GymPulse app</option>
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp (Business API)</option>
                </Select>
              </Field>
              <p className="text-xs text-ink-3">If a channel isn&apos;t set up for your gym, we&apos;ll tell you — nothing is marked as sent unless it was.</p>
              <Button
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await act(async () => {
                    const id = await ensureTask(p.memberId, p.taskId);
                    return api<{ status: string; error: string | null }>(`/api/gym/recovery/${id}`, { body: { action: "message", channel, body } });
                  });
                  setBusy(false);
                  if (res) {
                    if (res.status === "SKIPPED" || res.status === "FAILED") import("sonner").then(({ toast }) => toast.warning(`Not sent: ${res.error}`));
                    else import("sonner").then(({ toast }) => toast.success(res.status === "QUEUED" ? "Message queued for sending" : "Message sent"));
                    setMsgOpen(false);
                    router.refresh();
                  }
                }}
              >
                <Send /> Send message
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {!p.taskId && !p.compact && (
        <Button size="sm" onClick={async () => { const r = await act(() => api("/api/gym/recovery", { body: { memberId: p.memberId } }), "Recovery started"); if (r) router.refresh(); }}>
          <HeartHandshake /> Start recovery
        </Button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button ref={moreRef} variant="ghost" size="sm" aria-label={`More actions for ${first}`}><MoreHorizontal /><span className="sr-only sm:not-sr-only">More</span></Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setLogOpen(true)}><NotebookPen /> Log contact</MenuItem>
          {p.taskId && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => void markReturned()}><CheckCircle2 /> Mark as returned</MenuItem>
              <MenuItem tone="risk" onSelect={() => setLostOpen(true)}><XCircle /> Mark as lost</MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent title={`Follow-up for ${first}`} description="Record what happened and when to check in again." returnFocus={moreRef}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const follow = fd.get("followUpAt") ? new Date(String(fd.get("followUpAt"))).toISOString() : null;
              const r = await act(() => logContact(String(fd.get("method")), { result: String(fd.get("result") ?? "") || undefined, note: String(fd.get("note") ?? "") || undefined, followUpAt: follow }), "Contact recorded");
              if (r) {
                setLogOpen(false);
                router.refresh();
              }
            }}
          >
            <Field label="How did you reach them?">
              <Select name="method" defaultValue="CALL">
                <option value="CALL">Phone call</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="IN_PERSON">In person</option>
                <option value="EMAIL">Email</option>
              </Select>
            </Field>
            <Field label="Result" hint="What they said, in a few words.">
              <Input name="result" placeholder="e.g. Will come back Monday" maxLength={200} />
            </Field>
            <Field label="Follow up on (optional)">
              <Input name="followUpAt" type="datetime-local" />
            </Field>
            <Field label="Note (optional)">
              <Textarea name="note" maxLength={1000} />
            </Field>
            <Button type="submit" className="w-full">Save follow-up</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent title={`Mark ${first} as lost?`} description="They leave the recovery list. You can still start recovery again later." returnFocus={moreRef}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setLostOpen(false)}>Keep trying</Button>
            <Button variant="danger" onClick={() => void markLost()}><XCircle /> Mark as lost</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
