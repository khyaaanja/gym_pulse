"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Loader2, ShieldCheck, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RecordsCheck as Result } from "@/services/imports/preview";

// A calendar day ("YYYY-MM-DD") as "5 Oct 2026". Not @/lib/time's formatDate: that module pulls in date-fns-tz,
// whose import-time time-zone probe cost the landing page ~50 ms of main thread on a mid-range phone.
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const ACCEPT = ".csv,.xlsx,.xls,.pdf";
const MAX_FILES = 6;
const SAMPLE = "/samples/sample-register-august-2026.xlsx";

const STATUS: Record<string, { label: string; tone: string }> = {
  AT_RISK: { label: "At risk", tone: "bg-[#ff6a47]/20 text-[#ffb3a1]" },
  ATTENTION: { label: "Needs attention", tone: "bg-[#ffb454]/20 text-[#ffd08a]" },
  LOST: { label: "Plan ended", tone: "bg-white/10 text-white/70" },
  ACTIVE: { label: "Coming less", tone: "bg-[#ff6a9f]/20 text-[#ffb4d3]" },
};
const CONF: Record<string, string> = { LOW: "Low", MODERATE: "Medium", HIGH: "High" };
const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

/**
 * The homepage's free records check: drop one or more registers, see who may stop coming — no account.
 * Files go to /api/records-check, are read in memory and are not kept.
 */
export function RecordsCheck({ maxMb }: { maxMb: number }) {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  function add(list: FileList | File[]) {
    setError(null);
    const next = [...files, ...Array.from(list)].filter((f, i, all) => all.findIndex((g) => g.name === f.name && g.size === f.size) === i);
    if (next.length > MAX_FILES) return setError(`Check up to ${MAX_FILES} files at a time.`);
    const bad = next.find((f) => !/\.(csv|xlsx|xls|pdf)$/i.test(f.name));
    if (bad) return setError(`${bad.name}: please use a CSV, Excel or PDF file. You can upload photos after you sign up.`);
    if (next.reduce((a, f) => a + f.size, 0) > maxMb * 1024 * 1024) return setError(`All files together can be up to ${maxMb} MB.`);
    setFiles(next);
  }

  async function check(list: File[]) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    for (const f of list) form.append("file", f);
    try {
      setResult(await api<Result>("/api/records-check", { form }));
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 429 ? "You have run many checks in the last hour. Please try again later, or start a free trial." : e.message) : "Something went wrong while reading your file. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    setBusy(true);
    try {
      const blob = await (await fetch(SAMPLE)).blob();
      const f = new File([blob], "Attendance Register August 2026.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      setFiles([f]);
      await check([f]);
    } catch {
      setError("We couldn't load the sample register. Please try again.");
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setFiles([]);
    setError(null);
  }

  if (result) return <Report r={result} onReset={reset} focusRef={resultRef} />;

  return (
    <div className="mt-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={cn("rounded-[1.75rem] border-2 border-dashed p-6 text-center transition-colors", drag ? "border-brand bg-brand/10" : "border-white/20 bg-white/[0.03]")}
      >
        <UploadCloud className="mx-auto size-8 text-brand" aria-hidden />
        <p className="mt-3 font-semibold">Add your attendance register or member list</p>
        <p className="mt-1 text-sm text-white/65">CSV, Excel or PDF · up to {MAX_FILES} files (for example, one for each month) · {maxMb} MB in total</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button type="button" variant="ghost" className="text-white ring-1 ring-white/25 hover:bg-white/10 hover:text-white" disabled={busy} onClick={() => input.current?.click()}>
            <FileSpreadsheet /> Choose files
          </Button>
          <Button type="button" variant="link" className="text-white/80" disabled={busy} onClick={sample}>Try a sample register</Button>
        </div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose files to check" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Files to check">
          {files.map((f) => (
            <li key={f.name + f.size} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2 text-sm ring-1 ring-white/10">
              <FileSpreadsheet className="size-4 shrink-0 text-white/60" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button type="button" disabled={busy} onClick={() => setFiles(files.filter((x) => x !== f))} className="grid size-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label={`Remove ${f.name}`}>
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="mt-4 rounded-2xl bg-[#ff6a47]/15 px-4 py-3 text-sm text-[#ffc7b8] ring-1 ring-[#ff6a47]/30">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button size="lg" disabled={busy || files.length === 0} onClick={() => check(files)}>
          {busy ? <><Loader2 className="animate-spin" aria-hidden /> Reading your records…</> : "Check my records"}
        </Button>
        <p className="flex items-center gap-2 text-xs text-white/65"><ShieldCheck className="size-4 text-[#63d6a4]" aria-hidden />No account needed · Nothing is saved</p>
      </div>
    </div>
  );
}

function Report({ r, onReset, focusRef }: { r: Result; onReset: () => void; focusRef: React.RefObject<HTMLDivElement | null> }) {
  const flagged = r.watchlistTotal;
  const est = r.estimate;
  return (
    <div ref={focusRef} tabIndex={-1} aria-live="polite" className="mt-8 outline-none">
      <p className="text-sm text-white/65">
        {plural(r.membersFound, "member")} · {plural(r.attendanceRecords, "visit")} read
        {r.recordsEndBeforeToday && <> · counted up to {dayLabel(r.asOf)}, the last day in your records</>}
      </p>
      <h3 className="display mt-2 text-3xl font-extrabold leading-tight">
        {flagged > 0 ? <>{flagged} of {plural(r.membersFound, "member")} {flagged === 1 ? "needs" : "need"} a call.</> : <>No one looks likely to leave right now.</>}
      </h3>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["At risk", r.status.atRisk, `paid, but away ${r.thresholds.inactivityDays}+ days`],
          ["Needs attention", r.status.attention, "coming less, or plan ended"],
          ["Plan ended", r.status.lost, "ended a while ago"],
          ["Coming as usual", r.status.active, "no change"],
        ].map(([k, v, d]) => (
          <div key={String(k)} className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
            <dt className="text-xs text-white/60">{k}</dt>
            <dd className="display num text-2xl font-extrabold">{v}</dd>
            <dd className="text-[11px] leading-tight text-white/50">{d}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-2xl bg-white/[0.05] p-4 text-sm ring-1 ring-white/10">
        {est ? (
          <>
            <p>
              We think <span className="font-semibold">{est.atRiskLow > 0 ? `${est.atRiskLow}–${est.atRiskHigh}` : `up to ${est.atRiskHigh}`} {est.atRiskHigh === 1 ? "member" : "members"}</span> may leave
              {est.averageFeePaisa > 0 && est.atRiskHigh > 0 && <> · that is {est.monthlyExposureLowPaisa > 0 ? "about " : "up to "}<span className="font-semibold text-[#ff9a80]">{est.monthlyExposureLowPaisa > 0 ? `${formatMoney(est.monthlyExposureLowPaisa)}–` : ""}{formatMoney(est.monthlyExposureHighPaisa)}</span> a month in fees</>}.
            </p>
            <p className="mt-1 text-white/60">A range, not a promise. Confidence: {CONF[r.confidence] ?? r.confidence}{r.confidenceReasons[0] ? ` — ${r.confidenceReasons[0]}` : ""}.</p>
          </>
        ) : (
          <p className="text-white/70">We can&apos;t give a range yet: {r.insufficientReason} The members below are listed from facts in your records, like days since their last visit.</p>
        )}
      </div>

      {r.watchlist.length > 0 && (
        <>
          <h4 className="mt-6 font-semibold">Who to call first</h4>
          <ul className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {r.watchlist.map((m, i) => {
              const s = STATUS[m.status] ?? STATUS.ACTIVE!;
              return (
                <li key={i} className="rounded-2xl bg-white/[0.06] px-3 py-3 ring-1 ring-white/10">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", s.tone)}>{s.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/65">{m.reasons.join(" · ") || `${m.daysSinceLastVisit} day${m.daysSinceLastVisit === 1 ? "" : "s"} since last visit`}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="flex gap-[2px]" role="img" aria-label={`${m.recent.reduce((a, b) => a + b, 0)} visits in the last six weeks`}>
                      {m.recent.map((v, d) => <span key={d} className={cn("h-3 w-[3px] rounded-full", v ? "bg-[#63d6a4]" : "bg-white/12")} />)}
                    </span>
                    <span className="ml-auto text-xs text-white/60">{m.action}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {r.watchlistTotal > r.watchlist.length && <p className="mt-2 text-xs text-white/55">Showing the {r.watchlist.length} most urgent of {r.watchlistTotal}.</p>}
        </>
      )}

      {r.notes.length > 0 && (
        <details className="mt-4 text-xs text-white/60">
          <summary className="cursor-pointer">How we read your file{r.notes.length > 1 ? "s" : ""}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button asChild size="lg"><Link href="/signup">Track them every day — start free</Link></Button>
        <Button type="button" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={onReset}>Check other files</Button>
      </div>
      <p className="mt-3 text-xs text-white/50">Your files were not saved. Sign up to keep this list, get a new list every day and see who comes back.</p>
    </div>
  );
}
