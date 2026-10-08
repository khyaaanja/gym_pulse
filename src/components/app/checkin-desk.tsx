"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Search, UserCheck } from "lucide-react";
import { Input } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { RiskBadge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/client";

type M = { id: string; fullName: string; memberCode: string; phone: string | null; riskStatus: string };
type Result = { status: "accepted" | "duplicate"; memberName?: string; streak?: number; newRewards?: string[]; warning?: string; message?: string };

type Branch = { id: string; name: string; isPrimary: boolean };
const BRANCH_KEY = "gp.desk.branch";
const noop = () => () => {};
const readSavedBranch = () => {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null; // storage blocked: the main branch is used
  }
};

export function CheckInDesk({ locations = [] }: { locations?: Branch[] }) {
  const [q, setQ] = useState("");
  // The desk remembers which branch it sits at; the server falls back to the main branch.
  const saved = useSyncExternalStore(noop, readSavedBranch, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const branch = [picked, saved].find((id) => id && locations.some((l) => l.id === id)) ?? locations[0]?.id ?? "";
  const pickBranch = (id: string) => {
    setPicked(id);
    try {
      window.localStorage.setItem(BRANCH_KEY, id);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  };
  const [items, setItems] = useState<M[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => api<{ items: M[] }>(`/api/gym/members?q=${encodeURIComponent(q)}&pageSize=8`).then((r) => setItems(r.items)).catch(() => setItems([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? [] : items;

  async function checkIn(body: Record<string, string>, label: string) {
    setBusy(label);
    try {
      const r = await api<Result>("/api/gym/checkin", { body: branch ? { ...body, locationId: branch } : body });
      if (r.status === "duplicate") toast.info(r.message ?? "Already checked in today.");
      else {
        toast.success(`${r.memberName ?? "Member"} checked in${r.streak ? ` · ${r.streak}-day streak` : ""}`, { description: [r.warning, r.newRewards?.length ? `Unlocked: ${r.newRewards.join(", ")}` : null].filter(Boolean).join(" ") || undefined });
        setQ("");
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Check-in failed.");
    } finally {
      setBusy(null);
    }
  }

  // Scan a member's pass with the device camera where the browser supports BarcodeDetector.
  useEffect(() => {
    if (!scanning) return;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    // Both are missing outside secure contexts (plain-HTTP LAN installs).
    if (!Detector || !navigator.mediaDevices) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            stop = true;
            setScanning(false);
            await checkIn({ passToken: codes[0].rawValue }, "scan");
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      })
      .catch(() => {
        toast.error("Camera access was blocked.");
        setScanning(false);
      });
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div>
      {locations.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label="Branch">
          <span className="text-ink-3">Checking in at</span>
          {locations.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={branch === l.id} onClick={() => pickBranch(l.id)} className={`h-9 rounded-full px-3.5 font-medium ring-1 transition-colors ${branch === l.id ? "bg-brand text-brand-ink ring-brand" : "bg-surface text-ink-2 ring-line hover:bg-surface-2"}`}>{l.name}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or member ID" className="h-14 pl-10 text-base" aria-label="Find member to check in" autoFocus />
        </div>
        <Button variant="secondary" className="h-14 rounded-2xl" onClick={() => { if (!("BarcodeDetector" in window)) { toast.error("This browser can't scan QR codes. Search for the member instead."); return; } setScanning((s) => !s); }} aria-pressed={scanning}>
          <Camera /> <span className="sr-only sm:not-sr-only">Scan pass</span>
        </Button>
      </div>
      {scanning && <video ref={video} className="mt-3 aspect-video w-full rounded-2xl bg-ink object-cover" muted playsInline />}
      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
          {shown.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={m.fullName} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.fullName}</p>
                <p className="text-sm text-ink-3">{m.memberCode}{m.phone ? ` · ${m.phone}` : ""}</p>
              </div>
              <RiskBadge status={m.riskStatus} />
              <Button size="sm" onClick={() => checkIn({ memberId: m.id }, m.id)} disabled={busy === m.id}>
                <UserCheck /> Check in
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
