import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { analyzeRecords, type PreviewFile } from "@/services/imports/preview";
import { POST } from "@/app/api/records-check/route";

const proof = (...p: string[]) => path.join(process.cwd(), "documents/health-check-proof", ...p);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsx = (file: string): PreviewFile => ({ name: path.basename(file), type: XLSX_MIME, data: readFileSync(file) });
type Truth = { name: string; group: string }[];
const truth = (file: string) => JSON.parse(readFileSync(proof(file), "utf8")) as Truth;

let ipSeq = 0;
function post(files: { name: string; type: string; data: Buffer }[], headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const f of files) form.append("file", new File([new Uint8Array(f.data)], f.name, { type: f.type }));
  return POST(new NextRequest("http://localhost:3000/api/records-check", { method: "POST", body: form, headers: { "x-forwarded-for": `198.51.100.${++ipSeq}`, ...headers } }));
}

describe("free records check (no account)", () => {
  // Rate-limit buckets outlive a run; start each run with a clean window.
  beforeAll(() => prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "records-check" } } }));

  it("flags every member who faded or stopped in one monthly register, and no regulars", async () => {
    const r = await analyzeRecords([xlsx(proof("Attendance Register August 2026.xlsx"))], "2026-09-03");
    const t = truth("truth-2026-08.json");
    const flagged = new Set(r.watchlist.map((w) => w.name));
    const names = (...groups: string[]) => t.filter((m) => groups.includes(m.group)).map((m) => m.name);
    expect(r.membersFound).toBe(40);
    expect(r.asOf).toBe("2026-08-31"); // measured as of the register's last day, not "today"
    for (const n of names("FADING", "STOPPED_EARLY", "EXPIRED")) expect(flagged, n).toContain(n);
    for (const n of names("REGULAR", "NEW_JOINER")) expect(flagged, n).not.toContain(n);
    expect(r.confidence).toBe("LOW"); // one month: an estimate, but always low confidence
    expect(r.estimate).not.toBeNull();
    for (const w of r.watchlist) expect(w.recent).toHaveLength(42);
  });

  it("joins several monthly registers into one history per member", async () => {
    const files = ["July", "August", "September"].map((m) => xlsx(proof("three", `Attendance Register ${m} 2026.xlsx`)));
    const r = await analyzeRecords(files, "2026-10-01");
    expect(r.membersFound).toBe(40);
    expect(r.files.map((f) => f.registerMonth)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r.historyDays).toBeGreaterThanOrEqual(85);
    const t = truth("three/truth.json");
    const flagged = new Set(r.watchlist.map((w) => w.name));
    for (const m of t.filter((x) => x.group === "REGULAR")) expect(flagged, m.name).not.toContain(m.name);
    for (const m of t.filter((x) => x.group === "STOPPED" || x.group === "FADING")) expect(flagged, m.name).toContain(m.name);
  });

  it("reads a CSV member list", async () => {
    const csv = ["Name,Phone,Last visit,Expiry,Fee", "Ram Bahadur,9841000001,2026-09-29,2026-10-20,2500", "Hari Prasad,9841000002,2026-09-05,2026-10-10,2500", "Gita Devi,9841000003,2026-09-28,2026-11-01,2500"].join("\n");
    const r = await analyzeRecords([{ name: "members.csv", type: "text/csv", data: Buffer.from(csv) }], "2026-09-30");
    expect(r.membersFound).toBe(3);
    expect(r.watchlist.map((w) => w.name)).toEqual(["Hari Prasad"]);
    expect(r.watchlist[0]!.status).toBe("AT_RISK");
  });

  it("stores nothing", async () => {
    const counts = () => Promise.all([prisma.importJob.count(), prisma.importedFile.count(), prisma.importRow.count(), prisma.member.count(), prisma.predictionReport.count(), prisma.riskAssessment.count(), prisma.attendance.count()]);
    const before = await counts();
    const res = await post([xlsx(proof("Attendance Register August 2026.xlsx"))]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).membersFound).toBe(40);
    expect(await counts()).toEqual(before);
  });

  it("rejects photos, mismatched files and too many files", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    expect((await post([{ name: "register.png", type: "image/png", data: png }])).status).toBe(400);
    expect((await post([{ name: "register.xlsx", type: XLSX_MIME, data: Buffer.from("not a spreadsheet") }])).status).toBe(400);
    const csv = { name: "a.csv", type: "text/csv", data: Buffer.from("Name,Phone\nRam,9841000001\n") };
    expect((await post(Array.from({ length: 7 }, (_, i) => ({ ...csv, name: `a${i}.csv` })))).status).toBe(400);
  });

  it("blocks cross-site posts and limits each IP to 12 checks an hour", async () => {
    const csv = [{ name: "a.csv", type: "text/csv", data: Buffer.from("Name,Phone,Last visit\nRam,9841000001,2026-09-01\n") }];
    expect((await post(csv, { origin: "https://evil.example" })).status).toBe(403);
    const ip = { "x-forwarded-for": "203.0.113.77" };
    for (let i = 0; i < 12; i++) expect((await post(csv, ip)).status).not.toBe(429);
    expect((await post(csv, ip)).status).toBe(429);
  });
});
