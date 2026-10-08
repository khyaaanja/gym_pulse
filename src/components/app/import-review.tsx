"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/fields";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { act, api } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mapping = { sourceIndex: number; sourceHeader: string; targetField: string; confidence: number; isManual: boolean };
type Job = {
  id: string; status: string; recordType: string; registerMonth: string | null; fileName: string; kind: string; ocrUsed: boolean; ocrConfidence: number | null;
  totalRows: number; cleanRows: number; reviewRows: number; duplicateRows: number; invalidRows: number; importedRows: number; skippedRows: number; qualityScore: number | null;
  errorMessage: string | null; stats: Record<string, unknown>; rawDeleted: boolean; rawExpiresAt: string; scanStatus: string;
  mappings: Mapping[]; jobIssues: { type: string; message: string }[];
  report: { id: string; confidence: string; lossRangeLow: number | null; lossRangeHigh: number | null; rangeLow: number | null; rangeHigh: number | null; highRiskCount: number; insufficientReason: string | null } | null;
};
type Norm = { memberName: string | null; phone: string | null; email: string | null; memberCode: string | null; plan: string | null; lastVisit: string | null; visitDate: string | null; membershipExpiry: string | null; membershipStart: string | null; amountPaisa: number | null; visits: string[]; visitCount: number | null };
type Row = { id: string; rowIndex: number; status: string; normalized: Norm; raw: { cells: unknown[] }; fieldConfidence: Record<string, number> | null; duplicateOfId: string | null; duplicateReason: string | null; duplicateAction: string | null; edited: Record<string, unknown> | null; issues: { field: string | null; type: string; severity: string; message: string }[] };

const FILTERS = [
  { k: "ISSUES", l: "Needs attention" },
  { k: "ALL", l: "All rows" },
  { k: "CLEAN", l: "Clean" },
  { k: "DUPLICATE", l: "Duplicates" },
  { k: "INVALID", l: "Can't import" },
  { k: "SKIPPED", l: "Excluded" },
];
const ISSUE_LABEL: Record<string, string> = {
  INVALID_DATE: "invalid dates", MISSING_ATTENDANCE: "missing attendance", INVALID_PHONE: "invalid phone numbers", LOW_OCR_CONFIDENCE: "unclear in the photo",
  DUPLICATE: "possible duplicates", FUTURE_DATE: "dates in the future", MISSING_IDENTITY: "rows with no name, phone or ID", INVALID_NAME: "unreadable names",
  UNREADABLE_MARKS: "unreadable attendance marks", INVALID_AMOUNT: "invalid amounts", INVALID_EMAIL: "invalid emails",
};
const EDIT_FIELDS: { k: keyof Norm | "amountPaisa"; l: string }[] = [
  { k: "memberName", l: "Name" }, { k: "phone", l: "Phone" }, { k: "email", l: "Email" }, { k: "memberCode", l: "Member ID" }, { k: "plan", l: "Plan" },
  { k: "lastVisit", l: "Last visit" }, { k: "membershipStart", l: "Membership start" }, { k: "membershipExpiry", l: "Expiry" }, { k: "amountPaisa", l: "Amount (NPR)" },
];

export function ImportReview({ job, targetOptions, canEdit }: { job: Job; targetOptions: { value: string; label: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ISSUES");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<Record<number, string>>(() => Object.fromEntries(job.mappings.map((m) => [m.sourceIndex, m.targetField])));
  const [month, setMonth] = useState(job.registerMonth ?? "");
  // The page often mounts while the job is still PROCESSING (no mappings yet); re-seed local state
  // whenever the server's mappings change, or every select falls back to its first option.
  const serverMapping = JSON.stringify([job.mappings.map((m) => [m.sourceIndex, m.targetField]), job.registerMonth]);
  const [seenMapping, setSeenMapping] = useState(serverMapping);
  if (serverMapping !== seenMapping) {
    setSeenMapping(serverMapping);
    setMapping(Object.fromEntries(job.mappings.map((m) => [m.sourceIndex, m.targetField])));
    setMonth(job.registerMonth ?? "");
  }
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const working = job.status === "PROCESSING" || job.status === "IMPORTING";

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [working, router]);

  const load = useCallback(async () => {
    if (job.status !== "NEEDS_REVIEW" && job.status !== "IMPORTED") return;
    const r = await api<{ items: Row[]; total: number }>(`/api/gym/imports/${job.id}/rows?status=${filter}&page=${page}&pageSize=50`).catch(() => null);
    if (r) {
      setRows(r.items);
      setTotal(r.total);
    }
  }, [job.id, job.status, filter, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, job]);

  const refresh = async () => { await load(); router.refresh(); setSelected(new Set()); };
  const doAction = async (rowIds: string[], action: string, msg: string) => {
    setBusy(true);
    const r = await act(() => api(`/api/gym/imports/${job.id}/actions`, { body: { rowIds, action } }), msg);
    setBusy(false);
    if (r) await refresh();
  };

  const isGrid = job.recordType === "ATTENDANCE_GRID" || Object.values(mapping).some((t) => t.startsWith("day:"));
  const ready = (job.stats.readyRows as number | undefined) ?? job.cleanRows;
  // Duplicates already decided (attendance/payment rows are merged into the existing member by
  // default) are ready, not problems. Only undecided ones need the owner's attention.
  const matched = Math.max(0, ready - job.cleanRows);
  const undecided = Math.max(0, job.duplicateRows - matched);
  const needsDecision = job.reviewRows + undecided;
  const issueCounts = Object.fromEntries(
    Object.entries((job.stats.issueCounts ?? {}) as Record<string, number>).map(([k, n]) => [k, k === "DUPLICATE" ? undecided : n]).filter(([, n]) => Number(n) > 0),
  ) as Record<string, number>;
  const mappingDirty = job.mappings.some((m) => mapping[m.sourceIndex] !== m.targetField) || (month || null) !== (job.registerMonth ?? null);
  const dayOptions = useMemo(() => Array.from({ length: 32 }, (_, i) => ({ value: `day:${i + 1}`, label: `Day ${i + 1} (register)` })), []);

  if (working) {
    return (
      <Card><CardBody className="py-16 text-center">
        <Loader2 className="mx-auto size-10 animate-spin text-brand" aria-hidden />
        <p className="display mt-4 text-2xl font-semibold">{job.status === "IMPORTING" ? "Importing your records…" : job.ocrUsed ? "Reading your photo…" : "Reading your file…"}</p>
        <p className="mt-1 text-ink-3">{job.fileName}. This page updates on its own.</p>
      </CardBody></Card>
    );
  }

  if (job.status === "FAILED") {
    return (
      <Card><CardBody className="py-14 text-center">
        <AlertTriangle className="mx-auto size-10 text-risk" aria-hidden />
        <p className="display mt-4 text-2xl font-semibold">Something went wrong while processing your file.</p>
        <p className="mx-auto mt-2 max-w-lg text-ink-2">{job.errorMessage}</p>
        <div className="mt-6 flex justify-center gap-2">
          {canEdit && !job.rawDeleted && <Button onClick={async () => { const r = await act(() => api(`/api/gym/imports/${job.id}/reprocess`, { body: {} }), "Trying again"); if (r) router.refresh(); }}><RotateCcw /> Try again</Button>}
          <Button asChild variant="secondary"><Link href="/app/imports/new">Upload a different file</Link></Button>
        </div>
      </CardBody></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-3">{job.recordType.replace(/_/g, " ").toLowerCase()} · {job.ocrUsed ? `photo (read with OCR${job.ocrConfidence ? `, ${Math.round(job.ocrConfidence)}% average confidence` : ""})` : job.kind.toLowerCase()}</p>
          <h1 className="display text-3xl font-semibold">{job.status === "IMPORTED" ? "Imported" : "Ready to import"}</h1>
          <p className="text-ink-3">{job.fileName}</p>
        </div>
        <StatusPill status={job.status} />
      </div>

      {job.status === "IMPORTED" && (
        <Card className="bg-ok-soft ring-ok/20"><CardBody className="flex flex-wrap items-center gap-4">
          <CheckCircle2 className="size-8 text-ok" aria-hidden />
          <div className="flex-1">
            <p className="text-lg font-semibold">{job.importedRows} records imported, {job.skippedRows} skipped.</p>
            {job.report ? (
              job.report.confidence === "INSUFFICIENT" ? <p className="text-sm text-ink-2">Not enough data for a reliable estimate yet — {job.report.insufficientReason}</p>
                : <p className="text-sm text-ink-2">{job.report.highRiskCount} members may need attention. Estimated member loss over the next 30 days: {job.report.lossRangeLow}–{job.report.lossRangeHigh}.</p>
            ) : <p className="text-sm text-ink-2">Members are on your Pulse screen now.</p>}
          </div>
          {job.report && job.report.confidence !== "INSUFFICIENT" && <Button asChild><Link href={`/app/forecast/${job.report.id}`}>View risk report</Link></Button>}
          <Button asChild variant="secondary"><Link href="/app/pulse">Open Pulse</Link></Button>
        </CardBody></Card>
      )}

      {job.status === "NEEDS_REVIEW" && (
        <Card>
          <CardHeader title="Data quality" description={job.qualityScore !== null ? `${job.qualityScore}% of rows are ready as they are.` : undefined} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Records detected", job.totalRows, ""],
                ["Ready", ready, "text-ok"],
                ["Need review", job.reviewRows, "text-warn"],
                ["Possible duplicates", undecided, "text-warn"],
                ["Can't import", job.invalidRows, "text-risk"],
              ].map(([l, v, c]) => <div key={String(l)} className="rounded-2xl bg-mist p-4"><dt className="text-xs text-ink-3">{l}</dt><dd className={cn("display num text-3xl font-semibold", String(c))}>{v}</dd></div>)}
            </dl>
            {Object.keys(issueCounts).length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2 text-sm">
                {Object.entries(issueCounts).map(([k, n]) => <li key={k} className="rounded-full bg-warn-soft px-3 py-1 text-warn"><span className="num font-semibold">{n}</span> {ISSUE_LABEL[k] ?? k.toLowerCase()}</li>)}
              </ul>
            )}
            {job.jobIssues.length > 0 && <ul className="mt-4 space-y-1 text-sm text-ink-2">{job.jobIssues.map((i) => <li key={i.type} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />{i.message}</li>)}</ul>}
            {((job.stats.notes as string[] | undefined) ?? []).map((n) => <p key={n} className="mt-2 text-sm text-ink-3">{n}</p>)}
            {matched > 0 && <p className="mt-4 flex gap-2 text-sm text-ink-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />{matched} {matched === 1 ? "row matches a member" : "rows match members"} already in GymPulse. Their visits and memberships will be added to {matched === 1 ? "that member" : "those members"} — existing details are never overwritten.</p>}
            {needsDecision > 0 && <p className="mt-4 text-sm font-medium">{needsDecision} {needsDecision === 1 ? "row needs" : "rows need"} a decision before importing. Review the highlighted records.</p>}
            {canEdit && (
              <div className="mt-5 flex flex-wrap gap-2">
                {needsDecision > 0 && <Button variant="secondary" onClick={() => { setFilter("ISSUES"); document.getElementById("rows")?.scrollIntoView({ behavior: "smooth" }); }}>Review issues</Button>}
                <Button disabled={busy || ready === 0} onClick={async () => {
                  if (!confirm(`Import ${ready} records? Rows that still need review, unresolved duplicates and rows that can't be imported will be skipped.`)) return;
                  setBusy(true);
                  const r = await act(() => api(`/api/gym/imports/${job.id}/commit`, { body: {} }), "Import started");
                  setBusy(false);
                  if (r) router.refresh();
                }}>Import {ready} {ready === 1 ? "record" : "records"}</Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {job.status === "NEEDS_REVIEW" && canEdit && (
        <Card>
          <CardHeader title="Columns" description="We matched your columns automatically. Change any that look wrong." />
          <CardBody>
            <div className="grid-cols-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {job.mappings.map((m) => (
                <Field key={m.sourceIndex} label={`“${m.sourceHeader}”`} hint={m.isManual ? "Set by you" : m.confidence < 0.6 ? "Low-confidence guess — please check" : undefined} htmlFor={`map-${m.sourceIndex}`}>
                  <Select id={`map-${m.sourceIndex}`} value={mapping[m.sourceIndex]} onChange={(e) => setMapping({ ...mapping, [m.sourceIndex]: e.target.value })} className={m.confidence < 0.6 && !m.isManual ? "ring-warn" : undefined}>
                    {targetOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {isGrid && dayOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {mapping[m.sourceIndex]?.startsWith("date:") && <option value={mapping[m.sourceIndex]}>Attendance on {mapping[m.sourceIndex]!.slice(5)}</option>}
                  </Select>
                </Field>
              ))}
            </div>
            {isGrid && (
              <div className="mt-4 max-w-sm">
                <Field label="Which month is this register for?" hint="Use YYYY-MM, or BS:2082-05 for a Bikram Sambat month.">
                  <Input value={month} onChange={(e) => setMonth(e.target.value.trim())} placeholder="2026-08" />
                </Field>
              </div>
            )}
            <Button className="mt-5" variant="secondary" disabled={!mappingDirty || busy} onClick={async () => {
              setBusy(true);
              const changes = job.mappings.filter((m) => mapping[m.sourceIndex] !== m.targetField).map((m) => ({ sourceIndex: m.sourceIndex, targetField: mapping[m.sourceIndex]! }));
              const r = await act(() => api(`/api/gym/imports/${job.id}/mappings`, { method: "PATCH", body: { changes, registerMonth: isGrid ? month || null : undefined } }), "Columns updated — rows re-checked");
              setBusy(false);
              if (r) await refresh();
            }}>Apply column changes</Button>
          </CardBody>
        </Card>
      )}

      <Card id="rows">
        <CardHeader title="Preview" description={`${total} rows`} action={
          job.status === "NEEDS_REVIEW" && canEdit && selected.size > 0 ? (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => doAction([...selected], "ACCEPT", "Accepted")}>Accept {selected.size}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => doAction([...selected], "EXCLUDE", "Excluded")}>Exclude</Button>
            </div>
          ) : undefined
        } />
        <CardBody>
          <div className="relative -mx-1 mb-4 flex gap-1 overflow-x-auto px-1" role="tablist">
            {FILTERS.map((f) => <button key={f.k} role="tab" aria-selected={filter === f.k} onClick={() => { setFilter(f.k); setPage(1); }} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", filter === f.k ? "bg-ink text-mist" : "text-ink-2 hover:bg-surface-2")}>{f.l}</button>)}
          </div>
          {rows.length === 0 ? <p className="py-6 text-center text-sm text-ink-3">No rows here.</p> : (
            <div className="relative -mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    {job.status === "NEEDS_REVIEW" && canEdit && <th className="w-8 border-b border-line pb-2"><span className="sr-only">Select</span></th>}
                    <th className="border-b border-line pb-2 pr-3">Row</th><th className="border-b border-line pb-2 pr-3">Name</th><th className="border-b border-line pb-2 pr-3">Phone</th><th className="border-b border-line pb-2 pr-3">Plan</th>
                    <th className="border-b border-line pb-2 pr-3">Last visit</th><th className="border-b border-line pb-2 pr-3">Expiry</th><th className="border-b border-line pb-2 pr-3">Visits</th><th className="border-b border-line pb-2 pr-3">Status</th><th className="border-b border-line pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const n = r.normalized;
                    const low = (f: string) => (r.fieldConfidence?.[f] ?? 100) < 70 && !(r.edited && f in r.edited);
                    const bad = (f: string) => r.issues.some((i) => i.field === f && i.severity === "ERROR");
                    const cell = (f: string, v: React.ReactNode) => <td className={cn("border-b border-line/70 py-2.5 pr-3 align-top", low(f) && "bg-warn-soft", bad(f) && "text-risk")}>{v ?? <span className="text-ink-3">—</span>}</td>;
                    return (
                      <tr key={r.id} className={cn(r.status === "INVALID" && "opacity-70")}>
                        {job.status === "NEEDS_REVIEW" && canEdit && <td className="border-b border-line/70 py-2.5 align-top"><input type="checkbox" aria-label={`Select row ${r.rowIndex + 1}`} className="accent-[var(--brand)]" checked={selected.has(r.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSelected(s); }} /></td>}
                        <td className="num border-b border-line/70 py-2.5 pr-3 align-top text-ink-3">{r.rowIndex + 1}</td>
                        {cell("memberName", n.memberName)}
                        {cell("phone", n.phone)}
                        {cell("plan", n.plan)}
                        {cell("lastVisit", n.lastVisit ?? n.visitDate)}
                        {cell("membershipExpiry", n.membershipExpiry)}
                        {cell("visits", n.visits?.length ? n.visits.length : n.visitCount)}
                        <td className="border-b border-line/70 py-2.5 pr-3 align-top">
                          <StatusPill status={r.status} />
                          {r.issues.filter((i) => i.type !== "DUPLICATE").map((i, k) => <p key={k} className={cn("mt-1 max-w-64 text-xs", i.severity === "ERROR" ? "text-risk" : "text-warn")}>{i.message}</p>)}
                          {r.duplicateReason && <p className="mt-1 max-w-64 text-xs text-warn">{r.duplicateReason}{r.duplicateAction ? ` · ${r.duplicateAction === "MERGE" ? "will merge" : r.duplicateAction === "SKIP" ? "will skip" : "will create new"}` : " · choose what to do"}</p>}
                        </td>
                        <td className="border-b border-line/70 py-2.5 text-right align-top">
                          {job.status === "NEEDS_REVIEW" && canEdit && (
                            <div className="flex flex-wrap justify-end gap-1">
                              {r.status !== "SKIPPED" && r.status !== "IMPORTED" && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Fix</Button>}
                              {r.status === "NEEDS_REVIEW" && <Button size="sm" variant="ghost" onClick={() => doAction([r.id], "ACCEPT", "Accepted as-is")}>Accept</Button>}
                              {r.duplicateOfId && r.status !== "SKIPPED" && (
                                <Select aria-label="Duplicate decision" className="h-9 w-32 text-sm" value={r.duplicateAction ?? ""} onChange={(e) => e.target.value && doAction([r.id], e.target.value, "Decision saved")}>
                                  <option value="">Decide…</option>
                                  <option value="MERGE">Merge</option>
                                  <option value="SKIP">Skip</option>
                                  <option value="CREATE_NEW">Create new</option>
                                </Select>
                              )}
                              {r.status === "SKIPPED" ? <Button size="sm" variant="ghost" onClick={() => doAction([r.id], "RESTORE", "Restored")}>Restore</Button> : r.status !== "IMPORTED" && <Button size="sm" variant="ghost" aria-label="Exclude row" onClick={() => doAction([r.id], "EXCLUDE", "Excluded")}>Exclude</Button>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > 50 && (
            <div className="mt-4 flex justify-between text-sm">
              <span className="text-ink-3">Page {page} of {Math.ceil(total / 50)}</span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </span>
            </div>
          )}
          <p className="mt-4 text-xs text-ink-3">Highlighted cells were hard to read. Existing members are never overwritten: merging only fills empty details and adds attendance and history.</p>
        </CardBody>
      </Card>

      {canEdit && (
        <Card><CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-ink-2">{job.rawDeleted ? "The original file has been deleted." : `The original file is stored encrypted and will be deleted on ${new Date(job.rawExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`} Malware scan: {job.scanStatus === "NOT_CONFIGURED" ? "not configured on this server" : job.scanStatus.toLowerCase()}.</p>
          <div className="flex gap-2">
            {!job.rawDeleted && <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Delete the original uploaded file now? Imported records are kept.")) return; const r = await act(() => api(`/api/gym/imports/${job.id}`, { method: "DELETE" }), "Original file deleted"); if (r) router.refresh(); }}><Trash2 /> Delete original file</Button>}
            <Button size="sm" variant="ghost" className="text-risk" onClick={async () => { if (!confirm("Delete this import's file and all its preview rows? Members already imported stay in GymPulse.")) return; const r = await act(() => api(`/api/gym/imports/${job.id}?purge=true`, { method: "DELETE" }), "Import data deleted"); if (r) router.push("/app/imports"); }}>Delete import data</Button>
          </div>
        </CardBody></Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={`Fix row ${editing.rowIndex + 1}`} description="Type the correct values. Dates can be in any common format, including Bikram Sambat.">
            <details className="mb-4 rounded-xl bg-mist p-3 text-xs text-ink-2"><summary className="cursor-pointer font-medium"><Copy className="mr-1 inline size-3.5" />Original row</summary><p className="mt-2 break-words">{editing.raw.cells.map((c) => String(c ?? "")).join(" | ")}</p></details>
            <form className="grid-cols-1 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const values: Record<string, string> = {};
              for (const f of EDIT_FIELDS) {
                const v = String(fd.get(f.k) ?? "");
                const orig = f.k === "amountPaisa" ? (editing.normalized.amountPaisa ? String(editing.normalized.amountPaisa / 100) : "") : String((editing.normalized as Record<string, unknown>)[f.k] ?? "");
                if (v !== orig) values[f.k] = v;
              }
              if (!Object.keys(values).length) return setEditing(null);
              const r = await act(() => api(`/api/gym/imports/${job.id}/rows/${editing.id}`, { method: "PATCH", body: { values } }), "Row updated");
              if (r) { setEditing(null); await refresh(); }
            }}>
              {EDIT_FIELDS.map((f) => {
                const v = f.k === "amountPaisa" ? (editing.normalized.amountPaisa ? String(editing.normalized.amountPaisa / 100) : "") : String((editing.normalized as Record<string, unknown>)[f.k] ?? "");
                const issue = editing.issues.find((i) => i.field === f.k);
                return <Field key={f.k} label={f.l} error={issue?.severity === "ERROR" ? issue.message : undefined} hint={issue?.severity === "WARNING" ? issue.message : undefined} htmlFor={`e-${f.k}`}><Input id={`e-${f.k}`} name={f.k} defaultValue={v} /></Field>;
              })}
              <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit">Save row</Button></div>
            </form>
            <p className="mt-3 text-xs text-ink-3">{editing.normalized.amountPaisa ? `Currently read as ${formatMoney(editing.normalized.amountPaisa)}.` : ""}</p>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
