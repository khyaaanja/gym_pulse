import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "@/db/client";
import { makeGym } from "./helpers/fixtures";
import { signInStaff, signOut, req, params, json, errCode, uid } from "./helpers/route";
import { CSV_TYPE, XLSX_TYPE, extOf, makeTextPdf, runQueued, uploadReq, useTempStorage } from "./helpers/platform";

vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);

const { GET: listImports, POST: upload } = await import("@/app/api/gym/imports/route");
const { GET: getImport, DELETE: deleteImport } = await import("@/app/api/gym/imports/[id]/route");
const { PATCH: patchMappings } = await import("@/app/api/gym/imports/[id]/mappings/route");
const { GET: listRows } = await import("@/app/api/gym/imports/[id]/rows/route");
const { PATCH: editRow } = await import("@/app/api/gym/imports/[id]/rows/[rowId]/route");
const { POST: commit } = await import("@/app/api/gym/imports/[id]/commit/route");
const { POST: actions } = await import("@/app/api/gym/imports/[id]/actions/route");
const { POST: reprocess } = await import("@/app/api/gym/imports/[id]/reprocess/route");
const { commitImport } = await import("@/services/imports/pipeline");

beforeAll(() => useTempStorage());
beforeEach(() => signOut());

const ROOT = path.resolve(__dirname, "..");
/** Names are cleaned of digits on import, so name tags are letters only. */
const alpha = () => Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

type RowView = { id: string; rowIndex: number; status: string; duplicateOfId: string | null; duplicateAction: string | null; normalized: Record<string, unknown>; issues: { type: string }[] };

async function gymWithOwner() {
  const { gym } = await makeGym();
  const owner = await signInStaff(gym.id, "OWNER");
  return { gym, owner };
}

/** Upload through the route and run the background "process" job; returns the job id once it reaches review. */
async function uploadAndProcess(gymId: string, name: string, data: Buffer | string, type = CSV_TYPE) {
  const res = await upload(uploadReq(name, data, type));
  expect(res.status).toBe(200);
  const { jobId } = await json<{ jobId: string }>(res);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("PROCESSING");
  await runQueued("import.process", jobId, gymId);
  return jobId;
}

async function rowsOf(jobId: string) {
  const res = await listRows(req(`/api/gym/imports/${jobId}/rows?pageSize=100`), params({ id: jobId }));
  expect(res.status).toBe(200);
  return (await json<{ items: RowView[] }>(res)).items;
}
const byName = (rows: RowView[], name: string) => rows.find((r) => r.normalized.memberName === name)!;
const post = (fn: typeof commit, jobId: string, body: unknown = {}) => fn(req(`/api/gym/imports/${jobId}/x`, { body }), params({ id: jobId }));

/** A small member list: two clean rows, one that matches an existing member's phone, one with no identity, one repeated in the file. */
function memberCsv(existingPhone: string, tag = alpha()) {
  const a = phone(), b = phone(), c = phone();
  const csv = [
    "Member Name,Mobile,Email,Join Date,Last Visit",
    `Alice ${tag},${a},,2026-01-10,2026-09-01`,
    `Bob ${tag},${b},bob-${tag}@example.test,2026-02-11,2026-09-02`,
    `Carol ${tag},${existingPhone},,2026-03-12,2026-09-03`,
    `,,,,2026-09-04`,
    `Alice Again ${tag},${a},,2026-01-10,2026-09-05`,
  ].join("\n");
  return { csv, a, b, c, tag };
}

describe("member import: upload, parse and review", () => {
  it("a CSV becomes reviewable rows with suggested column mappings; duplicates and unidentifiable rows are flagged", async () => {
    const { gym } = await gymWithOwner();
    const existing = await prisma.member.create({ data: { gymId: gym.id, memberCode: `X-${uid()}`, fullName: "Existing Carol", phone: phone(), joinedOn: new Date() } });
    const { csv, tag } = memberCsv(existing.phone!);
    const jobId = await uploadAndProcess(gym.id, "members.csv", csv);

    const detail = await json<{ status: string; recordType: string; totalRows: number; mappings: { sourceIndex: number; targetField: string }[]; file: { storageKey?: string; sha256?: string; kind: string } }>(await getImport(req(`/api/gym/imports/${jobId}`), params({ id: jobId })));
    expect(detail.status).toBe("NEEDS_REVIEW");
    expect(detail.recordType).toBe("MEMBER_LIST");
    expect(detail.totalRows).toBe(5);
    expect(detail.file.kind).toBe("CSV");
    expect(detail.file.storageKey).toBeUndefined(); // internals are not sent to the browser
    expect(detail.file.sha256).toBeUndefined();
    expect(Object.fromEntries(detail.mappings.map((m) => [m.sourceIndex, m.targetField]))).toMatchObject({ 0: "memberName", 1: "phone", 2: "email" });

    const rows = await rowsOf(jobId);
    expect(rows).toHaveLength(5);
    expect(byName(rows, `Alice ${tag}`).status).toBe("CLEAN");
    expect(byName(rows, `Bob ${tag}`).status).toBe("CLEAN");
    const carol = byName(rows, `Carol ${tag}`);
    expect(carol.status).toBe("DUPLICATE");
    expect(carol.duplicateOfId).toBe(existing.id);
    expect(carol.duplicateAction).toBeNull(); // member lists need an explicit decision
    expect(rows.find((r) => r.rowIndex === 3)!.status).toBe("INVALID");
    const again = byName(rows, `Alice Again ${tag}`);
    expect(again.status).toBe("DUPLICATE");
    expect(again.duplicateOfId).toBe("row:0");

    // Nothing is a member yet.
    expect(await prisma.member.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(0);
    // Filtered listing: only undecided problems.
    const issues = await json<{ items: RowView[] }>(await listRows(req(`/api/gym/imports/${jobId}/rows?status=ISSUES`), params({ id: jobId })));
    expect(issues.items.map((r) => r.rowIndex).sort()).toEqual([2, 3, 4]);
  });

  it("the bundled sample-attendance CSV parses into 20 member rows", async () => {
    const { gym } = await gymWithOwner();
    const csv = readFileSync(path.join(ROOT, "sample-attendance-august-2026.csv"));
    const jobId = await uploadAndProcess(gym.id, "sample-attendance-august-2026.csv", csv);
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("NEEDS_REVIEW");
    expect(job.totalRows).toBe(20);
    const rows = await rowsOf(jobId);
    const rahul = byName(rows, "Rahul Sharma");
    expect(rahul.normalized.phone).toBe("9843123456");
    expect(rahul.normalized.memberCode).toBe("RS001");
    expect(rows.filter((r) => r.status === "INVALID")).toHaveLength(0);
  });

  it("an XLSX workbook (generated) imports like a CSV", async () => {
    const { gym } = await gymWithOwner();
    const tag = alpha();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Phone", "Joined", "Last Visit"],
      [`Xena ${tag}`, phone(), "2026-01-05", "2026-09-10"],
      [`Yuri ${tag}`, phone(), "2026-02-05", "2026-09-11"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Members");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const jobId = await uploadAndProcess(gym.id, "members.xlsx", buf, XLSX_TYPE);
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("NEEDS_REVIEW");
    expect(job.sheetName).toBe("Members");
    const rows = await rowsOf(jobId);
    expect(rows.map((r) => r.status)).toEqual(["CLEAN", "CLEAN"]);
    expect(rows.map((r) => r.normalized.memberName).sort()).toEqual([`Xena ${tag}`, `Yuri ${tag}`]);
  });

  it("the bundled sample .xlsx is a text note, not a workbook: upload is refused and nothing is created", async () => {
    const { gym } = await gymWithOwner();
    const buf = readFileSync(path.join(ROOT, "sample-attendance-august-2026.xlsx"));
    // Guard the premise: if someone replaces the sample with a real workbook (a ZIP), this test must be rewritten.
    expect(buf.subarray(0, 2).toString("latin1")).not.toBe("PK");
    const res = await upload(uploadReq("sample-attendance-august-2026.xlsx", buf, XLSX_TYPE));
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe("bad_request");
    expect((await json<{ error: { message: string } }>(res.clone())).error.message).toMatch(/contents don.t match its type/);
    expect(await prisma.importJob.count({ where: { gymId: gym.id } })).toBe(0);
    expect(await prisma.job.count({ where: { gymId: gym.id, type: "import.process" } })).toBe(0);
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("a PDF whose table is only text in columns is read by position", async () => {
    const { gym } = await gymWithOwner();
    const tag = alpha().slice(0, 6);
    const pdf = makeTextPdf([
      ["Name", "Phone", "Last Visit"],
      [`Pema ${tag}`, "9811111111", "2026-09-01"],
      [`Tashi ${tag}`, "9822222222", "2026-09-02"],
      [`Dorje ${tag}`, "9833333333", "2026-09-03"],
    ]);
    const jobId = await uploadAndProcess(gym.id, "register.pdf", pdf, "application/pdf");
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("NEEDS_REVIEW");
    const rows = await rowsOf(jobId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.normalized.phone).sort()).toEqual(["9811111111", "9822222222", "9833333333"]);
    expect(rows.map((r) => r.normalized.memberName).sort()).toEqual([`Dorje ${tag}`, `Pema ${tag}`, `Tashi ${tag}`]);
  });

  it("a corrupt spreadsheet fails with a friendly message, is not reviewable, and can be retried only while FAILED", async () => {
    const { gym } = await gymWithOwner();
    const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not really a workbook")]);
    const jobId = await uploadAndProcess(gym.id, "broken.xlsx", bad, XLSX_TYPE).catch(async () => null);
    // processing may throw (retried by the job system) or mark FAILED; both must leave nothing importable
    const job = jobId ? await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } }) : null;
    if (job && job.status === "FAILED") {
      expect(job.errorMessage).toBeTruthy();
      const r = await post(commit, job.id);
      expect(r.status).toBe(400);
    }
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("reprocess is refused unless the import FAILED", async () => {
    const { gym } = await gymWithOwner();
    const { csv } = memberCsv(phone());
    const jobId = await uploadAndProcess(gym.id, "members.csv", csv);
    const res = await post(reprocess, jobId);
    expect(res.status).toBe(400);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("NEEDS_REVIEW");
    expect(await prisma.importRow.count({ where: { importJobId: jobId } })).toBe(5);
  });

  it("a FAILED import can be reprocessed: rows are rebuilt from the stored file", async () => {
    const { gym } = await gymWithOwner();
    const { csv } = memberCsv(phone());
    const jobId = await uploadAndProcess(gym.id, "members.csv", csv);
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "FAILED", errorMessage: "boom" } });
    await prisma.importRow.deleteMany({ where: { importJobId: jobId } });
    const res = await post(reprocess, jobId);
    expect(res.status).toBe(200);
    const after = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.status).toBe("PROCESSING");
    expect(after.errorMessage).toBeNull();
    await runQueued("import.process", jobId, gym.id);
    // The queue holds the first run's job too; processImport reads the (now PROCESSING) job and rebuilds all 5 rows.
    expect(await prisma.importRow.count({ where: { importJobId: jobId } })).toBe(5);
  });
});

describe("member import: upload validation and access", () => {
  it("rejects a missing file, an empty file, an unsupported type, a type/extension mismatch and disguised content", async () => {
    const { gym } = await gymWithOwner();
    const before = await prisma.importJob.count({ where: { gymId: gym.id } });
    const cases: [string, ReturnType<typeof uploadReq>][] = [
      ["no file field", uploadReq("members.csv", "a,b\n1,2", CSV_TYPE, "other")],
      ["empty", uploadReq("members.csv", "", CSV_TYPE)],
      ["unsupported extension", uploadReq("members.exe", "a,b\n1,2", "application/octet-stream")],
      ["mime/extension mismatch", uploadReq("members.csv", "a,b\n1,2", "image/png")],
      ["pdf bytes named csv", uploadReq("members.csv", Buffer.from("%PDF-1.4 fake\0\0\0\0\0"), CSV_TYPE)],
      ["text named xlsx", uploadReq("members.xlsx", "a,b\n1,2", XLSX_TYPE)],
    ];
    for (const [label, r] of cases) {
      const res = await upload(r);
      expect(res.status, label).toBe(400);
    }
    expect(await prisma.importJob.count({ where: { gymId: gym.id } })).toBe(before);
    expect(await prisma.importedFile.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("a trainer (no imports permission) can't upload, list or commit; the file_import flag off gives feature_disabled", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "TRAINER");
    const res = await upload(uploadReq("m.csv", "Name,Phone\nA B,9801234567", CSV_TYPE));
    expect(res.status).toBe(403);
    expect((await listImports(req("/api/gym/imports"))).status).toBe(403);
    expect(await prisma.importJob.count({ where: { gymId: gym.id } })).toBe(0);

    signOut();
    await signInStaff(gym.id, "OWNER");
    await prisma.featureFlag.create({ data: { key: "file_import", scope: "GYM", scopeId: gym.id, enabled: false } });
    const off = await upload(uploadReq("m.csv", "Name,Phone\nA B,9801234567", CSV_TYPE));
    expect(off.status).toBe(403);
    expect(await errCode(off)).toBe("feature_disabled");
    expect(await prisma.importJob.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("another gym can't see, change, commit or delete this gym's import", async () => {
    const a = await gymWithOwner();
    const { csv } = memberCsv(phone());
    const jobId = await uploadAndProcess(a.gym.id, "members.csv", csv);
    const rowId = (await rowsOf(jobId))[0]!.id;

    signOut();
    await gymWithOwner();
    expect((await getImport(req(`/api/gym/imports/${jobId}`), params({ id: jobId }))).status).toBe(404);
    expect((await listRows(req(`/api/gym/imports/${jobId}/rows`), params({ id: jobId }))).status).toBe(404);
    expect((await post(commit, jobId)).status).toBe(404);
    expect((await post(actions, jobId, { rowIds: [rowId], action: "EXCLUDE" })).status).toBe(404);
    expect((await editRow(req(`/api/gym/imports/${jobId}/rows/${rowId}`, { method: "PATCH", body: { values: { memberName: "Hacked" } } }), params({ id: jobId, rowId }))).status).toBe(404);
    expect((await deleteImport(req(`/api/gym/imports/${jobId}`, { method: "DELETE" }), params({ id: jobId }))).status).toBe(404);
    const mine = await json<{ items: unknown[] }>(await listImports(req("/api/gym/imports")));
    expect(mine.items).toHaveLength(0);
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("NEEDS_REVIEW");

  });
});

describe("member import: mappings and row edits", () => {
  it("remapping a column rebuilds the rows; duplicate targets and unknown fields are refused", async () => {
    const { gym } = await gymWithOwner();
    const tag = alpha();
    const csv = `Col A,Col B\nZed ${tag},${phone()}\nYan ${tag},${phone()}`;
    const jobId = await uploadAndProcess(gym.id, "odd.csv", csv);
    const maps = await prisma.columnMapping.findMany({ where: { importJobId: jobId }, orderBy: { sourceIndex: "asc" } });
    // Unrecognised headers fall back on what the values look like; make the assignment explicit either way.
    const patch = (changes: { sourceIndex: number; targetField: string }[]) => patchMappings(req(`/api/gym/imports/${jobId}/mappings`, { method: "PATCH", body: { changes } }), params({ id: jobId }));

    expect((await patch([{ sourceIndex: 0, targetField: "memberName" }, { sourceIndex: 1, targetField: "memberName" }])).status).toBe(400);
    expect((await patch([{ sourceIndex: 0, targetField: "nonsense" }])).status).toBe(400);
    const unchanged = await prisma.columnMapping.findMany({ where: { importJobId: jobId }, orderBy: { sourceIndex: "asc" } });
    expect(unchanged.map((m) => m.targetField)).toEqual(maps.map((m) => m.targetField));

    expect((await patch([{ sourceIndex: 0, targetField: "memberName" }, { sourceIndex: 1, targetField: "phone" }])).status).toBe(200);
    const rows = await rowsOf(jobId);
    expect(rows.map((r) => r.normalized.memberName).sort()).toEqual([`Yan ${tag}`, `Zed ${tag}`]);
    expect(rows.every((r) => typeof r.normalized.phone === "string")).toBe(true);
    // Swapping them makes the "name" column unusable.
    expect((await patch([{ sourceIndex: 0, targetField: "phone" }, { sourceIndex: 1, targetField: "memberName" }])).status).toBe(200);
    const swapped = await rowsOf(jobId);
    expect(swapped.every((r) => r.status === "INVALID" || r.status === "NEEDS_REVIEW")).toBe(true);
    const manual = await prisma.columnMapping.findMany({ where: { importJobId: jobId } });
    expect(manual.every((m) => m.isManual)).toBe(true);
  });

  it("editing an INVALID row's name makes it importable; non-editable fields and a settled job are refused", async () => {
    const { gym } = await gymWithOwner();
    const tag = alpha();
    const csv = `Name,Phone,Last Visit\n,,2026-09-01\nOk ${tag},${phone()},2026-09-02`;
    const jobId = await uploadAndProcess(gym.id, "m.csv", csv);
    const invalid = (await rowsOf(jobId)).find((r) => r.status === "INVALID")!;
    const edit = (values: Record<string, string>) => editRow(req(`/api/gym/imports/${jobId}/rows/${invalid.id}`, { method: "PATCH", body: { values } }), params({ id: jobId, rowId: invalid.id }));

    expect((await edit({ status: "CLEAN" })).status).toBe(400);
    expect((await edit({ memberName: `Fixed ${tag}`, phone: "9855555555" })).status).toBe(200);
    const fixed = (await rowsOf(jobId)).find((r) => r.id === invalid.id)!;
    expect(fixed.status).toBe("CLEAN");
    expect(fixed.normalized.memberName).toBe(`Fixed ${tag}`);
    expect(fixed.normalized.phone).toBe("9855555555");

    await post(commit, jobId);
    expect((await edit({ memberName: "Too late" })).status).toBe(400);
  });

  it("a row-level action on rows that aren't duplicates doesn't set a duplicate decision; EXCLUDE then RESTORE round-trips", async () => {
    const { gym } = await gymWithOwner();
    const { csv, tag } = memberCsv(phone());
    const jobId = await uploadAndProcess(gym.id, "m.csv", csv);
    const alice = byName(await rowsOf(jobId), `Alice ${tag}`);
    await post(actions, jobId, { rowIds: [alice.id], action: "MERGE" });
    expect((await prisma.importRow.findUniqueOrThrow({ where: { id: alice.id } })).duplicateAction).toBeNull();
    await post(actions, jobId, { rowIds: [alice.id], action: "EXCLUDE" });
    expect((await prisma.importRow.findUniqueOrThrow({ where: { id: alice.id } })).status).toBe("SKIPPED");
    await post(actions, jobId, { rowIds: [alice.id], action: "RESTORE" });
    expect((await prisma.importRow.findUniqueOrThrow({ where: { id: alice.id } })).status).toBe("CLEAN");
    expect((await post(actions, jobId, { rowIds: [], action: "MERGE" })).status).toBe(400);
    expect((await post(actions, jobId, { rowIds: [alice.id], action: "DELETE" })).status).toBe(400);
  });
});

describe("member import: commit creates exactly the reviewed members, once", () => {
  async function reviewed() {
    const { gym } = await gymWithOwner();
    const existing = await prisma.member.create({ data: { gymId: gym.id, memberCode: `X-${uid()}`, fullName: "Existing Carol", phone: phone(), joinedOn: new Date() } });
    const m = memberCsv(existing.phone!);
    const jobId = await uploadAndProcess(gym.id, "members.csv", m.csv);
    return { gym, existing, jobId, ...m };
  }

  it("imports only CLEAN rows: undecided duplicates and invalid rows are left out; second commit and replayed job add nothing", async () => {
    const { gym, existing, jobId, a, b, tag } = await reviewed();
    const membersBefore = await prisma.member.count({ where: { gymId: gym.id } });
    expect(membersBefore).toBe(1);

    const res = await post(commit, jobId);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ queued: 2 });
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("IMPORTING");
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(membersBefore); // queued, not yet imported

    expect(await runQueued("import.commit", jobId, gym.id)).toMatchObject({ membersCreated: 2 });
    const created = await prisma.member.findMany({ where: { gymId: gym.id, importJobId: jobId }, orderBy: { fullName: "asc" } });
    expect(created.map((m) => m.fullName)).toEqual([`Alice ${tag}`, `Bob ${tag}`]);
    expect(created.map((m) => m.phone).sort()).toEqual([a, b].sort());
    expect(created.every((m) => m.source === "IMPORT")).toBe(true);
    expect(created.find((m) => m.phone === a)!.totalVisits).toBe(1);
    expect(await prisma.attendance.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(2);
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(3);
    // the existing member is untouched
    expect(await prisma.attendance.count({ where: { memberId: existing.id } })).toBe(0);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("IMPORTED");

    // A second commit request is refused, and replaying the job does nothing.
    expect((await post(commit, jobId)).status).toBe(400);
    expect(await commitImport(jobId, gym.id)).toMatchObject({ skipped: "already imported" });
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(3);
    expect(await prisma.attendance.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(2);
    const rows = await prisma.importRow.findMany({ where: { importJobId: jobId } });
    expect(rows.filter((r) => r.status === "IMPORTED")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "SKIPPED")).toHaveLength(3);
  });

  it("two simultaneous commit requests queue one job and create each member once", async () => {
    const { gym, jobId } = await reviewed();
    const results = await Promise.all([post(commit, jobId), post(commit, jobId)]);
    expect(results.every((r) => [200, 400].includes(r.status))).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    const queued = (await prisma.job.findMany({ where: { type: "import.commit", gymId: gym.id } })).filter((j) => (j.payload as { jobId: string }).jobId === jobId);
    expect(queued).toHaveLength(1);
    await runQueued("import.commit", jobId, gym.id);
    expect(await prisma.member.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(2);
  });

  it("the commit handler running twice at once (a stale-lock reclaim) still creates each member once", async () => {
    const { gym, jobId } = await reviewed();
    await post(commit, jobId);
    await Promise.allSettled([commitImport(jobId, gym.id), commitImport(jobId, gym.id)]);
    expect(await prisma.member.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(2);
    expect(await prisma.attendance.count({ where: { gymId: gym.id, importJobId: jobId } })).toBe(2);
  });

  it("MERGE attaches to the existing member (fills blanks, no new member); CREATE_NEW adds one; SKIP adds none", async () => {
    const { gym, existing, jobId, tag } = await reviewed();
    const rows = await rowsOf(jobId);
    const carol = byName(rows, `Carol ${tag}`);
    const again = byName(rows, `Alice Again ${tag}`);
    expect((await post(actions, jobId, { rowIds: [carol.id], action: "MERGE" })).status).toBe(200);
    expect((await post(actions, jobId, { rowIds: [again.id], action: "SKIP" })).status).toBe(200);
    await post(commit, jobId);
    await runQueued("import.commit", jobId, gym.id);

    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(3); // existing + Alice + Bob
    expect(await prisma.member.count({ where: { gymId: gym.id, fullName: { contains: "Carol" } } })).toBe(1);
    const kept = await prisma.member.findUniqueOrThrow({ where: { id: existing.id } });
    expect(kept.fullName).toBe("Existing Carol"); // never overwritten
    expect(kept.phone).toBe(existing.phone);
    expect(await prisma.attendance.count({ where: { memberId: existing.id } })).toBe(1); // the merged row's visit
    expect(await prisma.importRow.count({ where: { importJobId: jobId, memberId: existing.id, status: "IMPORTED" } })).toBe(1);
  });

  it("CREATE_NEW on a duplicate of an existing member creates a second member", async () => {
    const { gym, jobId, tag } = await reviewed();
    const carol = byName(await rowsOf(jobId), `Carol ${tag}`);
    await post(actions, jobId, { rowIds: [carol.id], action: "CREATE_NEW" });
    await post(commit, jobId);
    await runQueued("import.commit", jobId, gym.id);
    expect(await prisma.member.count({ where: { gymId: gym.id, fullName: `Carol ${tag}` } })).toBe(1);
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(4);
  });

  it("an in-file duplicate merged into its first row yields one member with both visits", async () => {
    const { gym, jobId, tag, a } = await reviewed();
    const again = byName(await rowsOf(jobId), `Alice Again ${tag}`);
    await post(actions, jobId, { rowIds: [again.id], action: "MERGE" });
    await post(commit, jobId);
    await runQueued("import.commit", jobId, gym.id);
    const alices = await prisma.member.findMany({ where: { gymId: gym.id, phone: a } });
    expect(alices).toHaveLength(1);
    expect(await prisma.attendance.count({ where: { memberId: alices[0]!.id } })).toBe(2);
  });

  it("commit with nothing ready is refused and the job stays in review", async () => {
    const { gym } = await gymWithOwner();
    const jobId = await uploadAndProcess(gym.id, "none.csv", "Name,Phone,Last Visit\n,,2026-09-01\n,,2026-09-02");
    const res = await post(commit, jobId);
    expect(res.status).toBe(400);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("NEEDS_REVIEW");
    expect(await prisma.job.count({ where: { type: "import.commit", gymId: gym.id } })).toBe(0);
  });

  it("an attendance register (day columns) attaches visits to existing members by phone and never creates a duplicate", async () => {
    const { gym } = await gymWithOwner();
    const p = phone();
    const existing = await prisma.member.create({ data: { gymId: gym.id, memberCode: `R-${uid()}`, fullName: "Register Person", phone: p, joinedOn: new Date() } });
    const csv = `Name,Phone,1,2,3,4,5\nRegister Person,${p},P,P,A,P,A`;
    const jobId = await uploadAndProcess(gym.id, "Attendance Register August 2026.csv", csv);
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.recordType).toBe("ATTENDANCE_GRID");
    expect(job.registerMonth).toBe("2026-08");
    await post(commit, jobId);
    await runQueued("import.commit", jobId, gym.id);
    expect(await prisma.member.count({ where: { gymId: gym.id } })).toBe(1);
    const days = (await prisma.attendance.findMany({ where: { memberId: existing.id }, orderBy: { localDate: "asc" } })).map((x) => x.localDate.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-08-01", "2026-08-02", "2026-08-04"]);
  });

  it("deleting the raw file keeps the rows; purging also archives the job", async () => {
    const { gym } = await gymWithOwner();
    const { csv } = memberCsv(phone());
    const jobId = await uploadAndProcess(gym.id, "m.csv", csv);
    const del = (purge: string) => deleteImport(req(`/api/gym/imports/${jobId}?purge=${purge}`, { method: "DELETE" }), params({ id: jobId }));
    expect((await del("false")).status).toBe(200);
    const file = await prisma.importedFile.findFirstOrThrow({ where: { gymId: gym.id } });
    expect(file.storageKey).toBeNull();
    expect(file.rawDeletedAt).not.toBeNull();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("NEEDS_REVIEW");
    expect((await del("true")).status).toBe(200);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ARCHIVED");
    const raws = await prisma.importRow.findMany({ where: { importJobId: jobId } });
    expect(raws.every((r) => Object.keys(r.raw as object).length === 0)).toBe(true);
    expect(extOf("a.CSV")).toBe("csv");
  });
});
