import { createHash } from "node:crypto";
import { nextMemberCode } from "@/services/members";
import { prisma } from "@/db/client";
import { tenantDb, type TenantDb } from "@/db/tenant";
import { gymSettings } from "@/config/gym-settings";
import { audit, SYSTEM_ACTOR, type AuditActor } from "@/lib/audit";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { assertWithinLimit, withinLimit } from "@/lib/limits";
import { resolveFlags } from "@/lib/flags";
import { log } from "@/lib/logger";
import { addDays, fromDbDate, toDbDate, today as todayIn } from "@/lib/time";
import { chunk } from "@/lib/utils";
import type { Gym, ImportRecordType } from "@/generated/prisma/client";
import { enqueue, PermanentJobError } from "../jobs";
import { generatePredictionReport } from "../risk/run";
import { streakFrom, streakGap } from "../attendance";
import { putEncrypted, getDecrypted, deleteStored } from "./storage";
import { sanitizeFilename, validateUpload, type AllowedExt } from "./detect";
import { scanBuffer } from "./scan";
import { guessRegisterMonth } from "./register-month";
import { parseToGrid, ParseError } from "./parse";
import { OcrUnavailable, UnreadableImage } from "./ocr";
import { detectHeaderRow, detectRecordType, suggestMappings, TARGET_FIELDS, type TargetField } from "./mapping";
import { buildRow, identityKey, indexExisting, matchExisting, statusFor, type BuildContext, type Edits, type Mapping, type NormRow, type RowIssue } from "./rows";

// ─────────────────────────────── Upload ───────────────────────────────

export async function createImport(gym: Gym, actor: AuditActor & { id: string }, file: { name: string; type: string; data: Buffer }) {
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
  if (file.data.length === 0) throw badRequest("That file is empty.");
  if (file.data.length > maxBytes) throw badRequest(`Files can be up to ${process.env.MAX_UPLOAD_MB ?? 10} MB.`);
  const v = validateUpload(file.name, file.type, file.data);
  if ("error" in v) throw badRequest(v.error);

  const flags = await resolveFlags(gym);
  if (!flags.file_import) throw new AppError(403, "feature_disabled", "Record import isn't available on your plan.");
  if (v.kind === "IMAGE" && !flags.ocr_import) throw new AppError(403, "feature_disabled", "Photo import isn't available on your plan.");
  if (v.kind === "IMAGE" && (process.env.OCR_PROVIDER ?? "none") === "none") throw new AppError(503, "ocr_unavailable", "OCR service unavailable. Please upload a spreadsheet instead.");
  await assertWithinLimit(gym.id, "importsPerMonth", gym.timezone);

  const scan = await scanBuffer(file.data);
  if (scan.status === "INFECTED") {
    await audit({ actor, action: "imports.rejected_malware", entityType: "ImportedFile", gymId: gym.id, metadata: { name: sanitizeFilename(file.name), detail: scan.detail } });
    throw badRequest("This file was blocked by our security scan.");
  }

  const db = tenantDb(gym.id);
  const settings = gymSettings(gym.settings);
  const sha = createHash("sha256").update(file.data).digest("hex");
  const record = await db.importedFile.create({
    data: {
      gymId: gym.id,
      originalName: sanitizeFilename(file.name),
      mimeType: file.type || "application/octet-stream",
      kind: v.kind,
      sizeBytes: file.data.length,
      sha256: sha,
      scanStatus: scan.status,
      uploadedById: actor.id,
      rawExpiresAt: new Date(Date.now() + settings.imports.rawFileRetentionDays * 86_400_000),
    },
  });
  const storageKey = await putEncrypted("imports", gym.id, record.id, file.data);
  await db.importedFile.update({ where: { id: record.id }, data: { storageKey } });
  const job = await db.importJob.create({ data: { gymId: gym.id, fileId: record.id, status: "PROCESSING", ocrUsed: v.kind === "IMAGE", createdById: actor.id } });
  await enqueue("import.process", { jobId: job.id, gymId: gym.id, ext: v.ext }, { gymId: gym.id, priority: 5, maxAttempts: 3, idempotencyKey: `import.process:${job.id}` });
  await audit({ actor, action: "imports.uploaded", entityType: "ImportJob", entityId: job.id, gymId: gym.id, after: { file: record.originalName, sizeBytes: record.sizeBytes, kind: record.kind, scan: scan.status } });
  return job;
}

// ─────────────────────────────── Processing ───────────────────────────────

type StoredRaw = { cells: unknown[]; conf?: number[] };

/** Job handler: decrypt → parse/OCR → detect header & mappings → build + validate rows → NEEDS_REVIEW. */
export async function processImport(jobId: string, gymId: string, ext: AllowedExt) {
  const db = tenantDb(gymId);
  const job = await db.importJob.findUnique({ where: { id: jobId }, include: { file: true } });
  if (!job) throw new PermanentJobError("Import job not found");
  if (job.status !== "PROCESSING") return { skipped: job.status };
  if (!job.file.storageKey) throw new PermanentJobError("Raw file already deleted");
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const today = todayIn(gym.timezone);
  const started = Date.now();

  let grid;
  try {
    grid = await parseToGrid(ext, await getDecrypted(job.file.storageKey));
  } catch (err) {
    const friendly =
      err instanceof ParseError || err instanceof UnreadableImage
        ? err.message
        : err instanceof OcrUnavailable
          ? "OCR service unavailable. Please upload a spreadsheet instead."
          : null;
    if (friendly) {
      await db.importJob.update({ where: { id: jobId }, data: { status: "FAILED", errorMessage: friendly, completedAt: new Date() } });
      await prisma.metricSample.create({ data: { name: job.ocrUsed ? "import.ocr_failed" : "import.parse_failed", value: 1, tags: { gymId } } });
      return { failed: friendly };
    }
    throw err; // unexpected → retried by the job system; marked FAILED if it dead-letters
  }

  const headerIdx = detectHeaderRow(grid.rows);
  const headers = (grid.rows[headerIdx] ?? []).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const body = grid.rows.slice(headerIdx + 1);
  const bodyConf = grid.confidence?.slice(headerIdx + 1);
  const settings = gymSettings(gym.settings);
  const suggestions = suggestMappings(headers, body.slice(0, 200), settings.imports.dateOrder);

  await db.columnMapping.createMany({
    data: suggestions.map((s) => ({ gymId, importJobId: jobId, sourceIndex: s.index, sourceHeader: s.header.slice(0, 120), targetField: s.target, confidence: s.confidence })),
  });
  const needsMonth = suggestions.some((s) => String(s.target).startsWith("day:"));
  const reg = needsMonth ? guessRegisterMonth([job.file.originalName, grid.sheetName, ...headers], today) : null;

  await db.importRow.createMany({
    data: body.map((cells, i) => ({
      gymId,
      importJobId: jobId,
      rowIndex: i,
      raw: { cells: cells.map((c) => (c instanceof Date ? c.toISOString() : c)), conf: bodyConf?.[i] } as never,
      normalized: {},
      status: "NEEDS_REVIEW" as const,
    })),
  });
  await db.importJob.update({
    where: { id: jobId },
    data: {
      headerRowIndex: headerIdx,
      sheetName: grid.sheetName,
      registerMonth: reg?.month ?? null,
      ocrUsed: grid.ocrUsed,
      ocrConfidence: grid.ocrConfidence,
      stats: { notes: grid.notes, registerMonthAssumed: reg?.assumed ?? false },
    },
  });
  await rebuildRows(gymId, jobId);
  await db.importJob.update({ where: { id: jobId }, data: { status: "NEEDS_REVIEW" } });
  await prisma.metricSample.create({ data: { name: "import.processing_ms", value: Date.now() - started, tags: { gymId, ocr: grid.ocrUsed } } });
  return { rows: body.length };
}

/**
 * (Re)builds every row from its stored raw cells using the current mappings and staff edits,
 * then re-runs duplicate detection and recomputes the data-quality summary. Used after
 * processing, after mapping changes and after row edits.
 */
export async function rebuildRows(gymId: string, jobId: string, onlyRowIds?: string[]) {
  const db = tenantDb(gymId);
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { mappings: { orderBy: { sourceIndex: "asc" } } } });
  const settings = gymSettings(gym.settings);
  const today = todayIn(gym.timezone);
  const mappings: Mapping[] = job.mappings.map((m) => ({ sourceIndex: m.sourceIndex, sourceHeader: m.sourceHeader, targetField: m.targetField }));
  const rows = await db.importRow.findMany({ where: { importJobId: jobId }, orderBy: { rowIndex: "asc" } });

  // Record type from a first pass over the data.
  const preview = rows.slice(0, 300).map((r) => {
    const raw = r.raw as StoredRaw;
    const o: Record<string, unknown> = {};
    for (const m of mappings) if (!String(m.targetField).includes(":")) o[m.targetField] = raw.cells[m.sourceIndex];
    return o;
  });
  const recordType: ImportRecordType = detectRecordType(mappings.map((m) => ({ target: m.targetField as TargetField })), preview);
  const ctx: BuildContext = { today, dateOrder: settings.imports.dateOrder, registerMonth: job.registerMonth, isMemberList: recordType === "MEMBER_LIST" };

  const existing = await db.member.findMany({ where: { archivedAt: null }, select: { id: true, memberCode: true, fullName: true, phone: true, email: true } });
  const index = indexExisting(existing);
  const groupedTypes: ImportRecordType[] = ["ATTENDANCE_LOG", "ATTENDANCE_GRID", "PAYMENTS"];
  const grouped = groupedTypes.includes(recordType);

  let ambiguous = 0, bs = 0;
  const built = rows.map((r) => {
    const raw = r.raw as StoredRaw;
    const edits = (r.edited ?? {}) as Edits;
    const b = buildRow(raw.cells, mappings, ctx, edits, raw.conf);
    ambiguous += b.ambiguousDates;
    bs += b.bsDates;
    return { row: r, ...b, edits };
  });

  // Duplicate detection: in-file (member lists) and against existing members (all types).
  const firstSeen = new Map<string, number>();
  const updates = built.map((b) => {
    const accepted = !!b.edits.__accepted;
    let status = b.row.status === "SKIPPED" ? "SKIPPED" : statusFor(b.issues, accepted);
    let duplicateOfId: string | null = null;
    let duplicateReason: string | null = null;
    let duplicateAction = b.row.duplicateAction;
    if (status !== "INVALID" && status !== "SKIPPED") {
      const keys = [b.norm.memberCode && `code:${b.norm.memberCode.toLowerCase()}`, b.norm.phone && `phone:${b.norm.phone}`, b.norm.email && `email:${b.norm.email}`].filter(Boolean) as string[];
      if (!grouped) {
        const prior = keys.map((k) => firstSeen.get(k)).find((x) => x !== undefined);
        if (prior !== undefined) {
          duplicateOfId = `row:${prior}`;
          duplicateReason = `Same ${keys[0]!.split(":")[0] === "code" ? "membership ID" : keys[0]!.split(":")[0]} as row ${prior + 1} in this file`;
        } else keys.forEach((k) => firstSeen.set(k, b.row.rowIndex));
      }
      if (!duplicateOfId) {
        const match = matchExisting(b.norm, index);
        if (match) {
          duplicateOfId = match.duplicateOfId;
          duplicateReason = match.reason;
          // Attendance/payment files naturally refer to existing members: attach by default (never overwrites details).
          if (grouped && match.strong && !duplicateAction) duplicateAction = "MERGE";
        }
      }
      if (duplicateOfId && status === "CLEAN") status = "DUPLICATE";
      if (!duplicateOfId) duplicateAction = null;
    }
    return { id: b.row.id, status: status as never, normalized: b.norm, fieldConfidence: b.fieldConfidence, duplicateOfId, duplicateReason, duplicateAction, issues: b.issues, rowIndex: b.row.rowIndex };
  });

  const target = onlyRowIds ? updates.filter((u) => onlyRowIds.includes(u.id) || u.duplicateOfId) : updates;
  for (const batch of chunk(target, 200)) {
    await db.$transaction([
      ...batch.map((u) =>
        db.importRow.update({
          where: { id: u.id },
          data: { status: u.status, normalized: u.normalized as never, fieldConfidence: (u.fieldConfidence ?? undefined) as never, duplicateOfId: u.duplicateOfId, duplicateReason: u.duplicateReason, duplicateAction: u.duplicateAction },
        }),
      ),
    ]);
  }

  // Issues are rebuilt from scratch so the report always reflects the current state.
  await db.dataQualityIssue.deleteMany({ where: { importJobId: jobId } });
  const issueRows = updates.flatMap((u) =>
    u.issues.map((i: RowIssue) => ({ gymId, importJobId: jobId, importRowId: u.id, field: i.field, type: i.type, severity: i.severity, message: i.message.slice(0, 300) })),
  );
  for (const u of updates) if (u.duplicateOfId) issueRows.push({ gymId, importJobId: jobId, importRowId: u.id, field: null, type: "DUPLICATE", severity: "WARNING", message: u.duplicateReason ?? "Possible duplicate" });
  const jobIssues = [];
  if (ambiguous > 0) jobIssues.push({ type: "AMBIGUOUS_DATES", message: `${ambiguous} date${ambiguous === 1 ? "" : "s"} like 03/04/2026 ${ambiguous === 1 ? "was" : "were"} read as ${settings.imports.dateOrder === "MDY" ? "month/day/year" : "day/month/year"}. Change the date format in Settings if that's wrong.` });
  if (bs > 0) jobIssues.push({ type: "BS_DATES", message: `${bs} Bikram Sambat date${bs === 1 ? " was" : "s were"} converted to AD.` });
  const stats = (job.stats ?? {}) as Record<string, unknown>;
  if (job.registerMonth && stats.registerMonthAssumed) jobIssues.push({ type: "REGISTER_MONTH_ASSUMED", message: `We assumed this register is for ${job.registerMonth.replace("BS:", "BS ")}. Change the month if that's wrong.` });
  for (const ji of jobIssues) issueRows.push({ gymId, importJobId: jobId, importRowId: null as never, field: null, type: ji.type, severity: "WARNING", message: ji.message });
  for (const batch of chunk(issueRows, 1000)) await db.dataQualityIssue.createMany({ data: batch });

  return refreshCounts(db, jobId, recordType, { ambiguous, bs });
}

async function refreshCounts(db: TenantDb, jobId: string, recordType: ImportRecordType, extra: Record<string, number> = {}) {
  const [byStatus, issueTypes, job, decidedDuplicates] = await Promise.all([
    db.importRow.groupBy({ by: ["status"], where: { importJobId: jobId }, _count: true }),
    db.dataQualityIssue.groupBy({ by: ["type"], where: { importJobId: jobId, importRowId: { not: null } }, _count: { importRowId: true } }),
    db.importJob.findUniqueOrThrow({ where: { id: jobId } }),
    db.importRow.count({ where: { importJobId: jobId, status: "DUPLICATE", duplicateAction: { in: ["MERGE", "CREATE_NEW"] } } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const total = byStatus.reduce((a, b) => a + b._count, 0);
  const clean = count("CLEAN");
  const issueCounts = Object.fromEntries(issueTypes.map((i) => [i.type, i._count.importRowId]));
  const stats = { ...((job.stats ?? {}) as Record<string, unknown>), issueCounts, readyRows: clean + decidedDuplicates, ...extra };
  return db.importJob.update({
    where: { id: jobId },
    data: {
      recordType,
      totalRows: total,
      cleanRows: clean,
      reviewRows: count("NEEDS_REVIEW"),
      duplicateRows: count("DUPLICATE"),
      invalidRows: count("INVALID"),
      skippedRows: count("SKIPPED"),
      importedRows: count("IMPORTED"),
      qualityScore: total ? Math.round(((clean + count("DUPLICATE") + count("IMPORTED")) / total) * 100) : null,
      stats: stats as never,
    },
  });
}

// ─────────────────────────────── Review actions ───────────────────────────────

async function reviewableJob(gymId: string, jobId: string) {
  const job = await tenantDb(gymId).importJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("Import not found.");
  if (job.status !== "NEEDS_REVIEW") throw badRequest("This import can't be changed any more.");
  return job;
}

export async function updateMappings(gymId: string, jobId: string, changes: { sourceIndex: number; targetField: string }[], registerMonth: string | null | undefined, actor: AuditActor) {
  await reviewableJob(gymId, jobId);
  const db = tenantDb(gymId);
  const valid = new Set(Object.keys(TARGET_FIELDS));
  for (const c of changes) {
    const ok = valid.has(c.targetField) || /^day:([1-9]|[12]\d|3[0-2])$/.test(c.targetField) || /^date:\d{4}-\d{2}-\d{2}$/.test(c.targetField);
    if (!ok) throw badRequest(`Unknown field "${c.targetField}".`);
  }
  const current = await db.columnMapping.findMany({ where: { importJobId: jobId } });
  const final = current.map((m) => changes.find((c) => c.sourceIndex === m.sourceIndex)?.targetField ?? m.targetField);
  const seen = new Set<string>();
  for (const t of final) {
    if (!valid.has(t) || t === "ignore") continue;
    if (seen.has(t)) throw badRequest(`"${TARGET_FIELDS[t as keyof typeof TARGET_FIELDS]}" is mapped to more than one column.`);
    seen.add(t);
  }
  for (const c of changes) {
    await db.columnMapping.updateMany({ where: { importJobId: jobId, sourceIndex: c.sourceIndex }, data: { targetField: c.targetField, isManual: true, confidence: 1 } });
  }
  if (registerMonth !== undefined) {
    if (registerMonth !== null && !/^(BS:)?\d{4}-(0[1-9]|1[0-2])$/.test(registerMonth)) throw badRequest("Choose a valid month.");
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    await db.importJob.update({ where: { id: jobId }, data: { registerMonth, stats: { ...((job.stats ?? {}) as object), registerMonthAssumed: false } } });
  }
  await audit({ actor, action: "imports.mapping_changed", entityType: "ImportJob", entityId: jobId, gymId, after: { changes, registerMonth } });
  return rebuildRows(gymId, jobId);
}

const EDITABLE = new Set(["memberName", "phone", "email", "memberCode", "joinDate", "lastVisit", "visitDate", "plan", "membershipStart", "membershipExpiry", "amountPaisa", "paymentDate", "visitCount"]);

export async function editRow(gymId: string, jobId: string, rowId: string, values: Record<string, string>, actor: AuditActor & { id?: string | null }) {
  await reviewableJob(gymId, jobId);
  const db = tenantDb(gymId);
  const row = await db.importRow.findFirst({ where: { id: rowId, importJobId: jobId } });
  if (!row) throw notFound("Row not found.");
  for (const k of Object.keys(values)) if (!EDITABLE.has(k)) throw badRequest(`Field "${k}" can't be edited.`);
  const edited = { ...((row.edited ?? {}) as Edits), ...values };
  await db.importRow.update({ where: { id: row.id }, data: { edited: edited as never, editedById: actor.id ?? null, status: row.status === "SKIPPED" ? "NEEDS_REVIEW" : row.status } });
  await audit({ actor, action: "imports.row_edited", entityType: "ImportRow", entityId: row.id, gymId, before: row.normalized, after: values });
  await rebuildRows(gymId, jobId);
  return db.importRow.findUniqueOrThrow({ where: { id: row.id }, include: { issues: true } });
}

export type RowAction = "MERGE" | "SKIP" | "CREATE_NEW" | "ACCEPT" | "EXCLUDE" | "RESTORE";

export async function applyRowAction(gymId: string, jobId: string, rowIds: string[], action: RowAction, actor: AuditActor) {
  await reviewableJob(gymId, jobId);
  const db = tenantDb(gymId);
  const rows = await db.importRow.findMany({ where: { importJobId: jobId, id: { in: rowIds } } });
  for (const r of rows) {
    if (action === "MERGE" || action === "SKIP" || action === "CREATE_NEW") {
      if (!r.duplicateOfId) continue;
      await db.importRow.update({ where: { id: r.id }, data: { duplicateAction: action } });
    } else if (action === "ACCEPT") {
      await db.importRow.update({ where: { id: r.id }, data: { edited: { ...((r.edited ?? {}) as object), __accepted: true } } });
    } else if (action === "EXCLUDE") {
      await db.importRow.update({ where: { id: r.id }, data: { status: "SKIPPED" } });
    } else if (action === "RESTORE") {
      await db.importRow.update({ where: { id: r.id }, data: { status: "NEEDS_REVIEW" } });
    }
  }
  await audit({ actor, action: `imports.rows_${action.toLowerCase()}`, entityType: "ImportJob", entityId: jobId, gymId, metadata: { count: rows.length } });
  return rebuildRows(gymId, jobId);
}

/** Rows that will be imported: clean rows, plus duplicates with an explicit merge/create decision. */
export function importable(r: { status: string; duplicateAction: string | null }) {
  if (r.status === "CLEAN") return true;
  if (r.status === "DUPLICATE") return r.duplicateAction === "MERGE" || r.duplicateAction === "CREATE_NEW";
  return false;
}

export async function requestCommit(gymId: string, jobId: string, actor: AuditActor) {
  const job = await reviewableJob(gymId, jobId);
  const rows = await tenantDb(gymId).importRow.findMany({ where: { importJobId: jobId }, select: { status: true, duplicateAction: true } });
  const n = rows.filter(importable).length;
  if (n === 0) throw badRequest("There are no rows ready to import. Review the highlighted records first.");
  await tenantDb(gymId).importJob.update({ where: { id: job.id }, data: { status: "IMPORTING" } });
  await enqueue("import.commit", { jobId, gymId }, { gymId, priority: 5, maxAttempts: 3, idempotencyKey: `import.commit:${jobId}` });
  await audit({ actor, action: "imports.commit_requested", entityType: "ImportJob", entityId: jobId, gymId, metadata: { rows: n } });
  return { queued: n };
}

// ─────────────────────────────── Commit ───────────────────────────────

/**
 * Job handler. Idempotent: rows already IMPORTED are skipped, so a retried job resumes.
 * Existing member details are never overwritten — merges only fill empty fields and add
 * attendance/membership/payment history; conflicts are recorded as data-quality notes.
 */
export async function commitImport(jobId: string, gymId: string) {
  const db = tenantDb(gymId);
  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job) throw new PermanentJobError("Import job not found");
  if (job.status === "IMPORTED") return { skipped: "already imported" };
  if (job.status !== "IMPORTING") return { skipped: job.status };
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const today = todayIn(gym.timezone);
  const rows = await db.importRow.findMany({ where: { importJobId: jobId }, orderBy: { rowIndex: "asc" } });
  const plans = await db.membershipPlan.findMany();
  const usedCodes = new Set((await db.member.findMany({ select: { memberCode: true } })).map((m) => m.memberCode.toLowerCase()));
  const grouped = job.recordType === "ATTENDANCE_LOG" || job.recordType === "ATTENDANCE_GRID" || job.recordType === "PAYMENTS";

  // Group rows that describe the same person.
  const groups = new Map<string, typeof rows>();
  const rowMember = new Map<number, string>(); // rowIndex → memberId (for in-file merges)
  for (const r of rows) {
    if (!importable(r)) continue;
    const n = r.normalized as unknown as NormRow;
    let key = grouped ? identityKey(n) ?? `row:${r.rowIndex}` : `row:${r.rowIndex}`;
    if (r.duplicateOfId?.startsWith("row:") && r.duplicateAction === "MERGE") key = r.duplicateOfId;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const created: string[] = [];
  const touched = new Set<string>();
  let importedRows = 0;

  const resolvePlan = async (name: string | null, days: number | null, amount: number | null) => {
    if (name) {
      const byName = plans.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (byName) return byName;
    }
    if (days) {
      const byDays = plans.find((p) => p.durationDays === days && p.active);
      if (byDays) return byDays;
    }
    const label = (name ?? `${days ?? 30}-day plan`).slice(0, 60);
    const plan = await db.membershipPlan.upsert({
      where: { gymId_name: { gymId, name: label } },
      create: { gymId, name: label, durationDays: days ?? 30, pricePaisa: amount ?? 0, active: false, isImported: true },
      update: {},
    });
    plans.push(plan);
    return plan;
  };

  for (const [key, groupRows] of groups) {
    const pending = groupRows.filter((r) => r.status !== "IMPORTED");
    if (!pending.length) continue;
    const norms = groupRows.map((r) => r.normalized as unknown as NormRow);
    const pick = <K extends keyof NormRow>(k: K) => norms.map((n) => n[k]).find((v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) ?? null;
    const lead = groupRows[0]!;

    let memberId: string | null = null;
    if (key.startsWith("row:") && lead.duplicateOfId?.startsWith("row:") && lead.duplicateAction === "MERGE") {
      memberId = rowMember.get(Number(lead.duplicateOfId.slice(4))) ?? null;
    }
    const existingTarget = lead.duplicateOfId && !lead.duplicateOfId.startsWith("row:") && lead.duplicateAction === "MERGE" ? lead.duplicateOfId : null;

    await prisma.$transaction(async (tx) => {
      if (existingTarget) {
        const m = await tx.member.findFirstOrThrow({ where: { id: existingTarget, gymId } });
        memberId = m.id;
        const fill: Record<string, string> = {};
        const phone = pick("phone") as string | null;
        const email = pick("email") as string | null;
        if (phone && !m.phone) fill.phone = phone;
        if (email && !m.email) fill.email = email;
        if (Object.keys(fill).length) await tx.member.update({ where: { id: m.id }, data: fill });
        const conflicts = [
          phone && m.phone && phone !== m.phone ? `Kept existing phone ${m.phone} (file had ${phone})` : null,
          email && m.email && email !== m.email ? `Kept existing email ${m.email} (file had ${email})` : null,
        ].filter(Boolean) as string[];
        for (const c of conflicts) {
          await tx.dataQualityIssue.create({ data: { gymId, importJobId: jobId, importRowId: lead.id, type: "MERGE_CONFLICT", severity: "WARNING", message: c } });
        }
      } else if (!memberId) {
        const code = (pick("memberCode") as string | null) ?? null;
        const memberCode = code && !usedCodes.has(code.toLowerCase()) ? code : await nextMemberCode(db, usedCodes);
        usedCodes.add(memberCode.toLowerCase());
        const visitDates = norms.flatMap((n) => [n.lastVisit, n.visitDate, ...n.visits]).filter(Boolean) as string[];
        const joined = (pick("joinDate") as string | null) ?? (pick("membershipStart") as string | null) ?? visitDates.sort()[0] ?? today;
        const name = (pick("memberName") as string | null) ?? `Member ${(pick("phone") as string | null) ?? memberCode}`;
        const m = await tx.member.create({
          data: {
            gymId,
            memberCode,
            fullName: name,
            phone: pick("phone") as string | null,
            email: pick("email") as string | null,
            joinedOn: toDbDate(joined),
            source: "IMPORT",
            importJobId: jobId,
          },
        });
        memberId = m.id;
        created.push(m.id);
      }
      const mid = memberId!;
      for (const r of groupRows) rowMember.set(r.rowIndex, mid);

      // Membership: one per distinct expiry, skipped if the member already has one covering that date.
      const expiries = [...new Set(norms.map((n) => n.membershipExpiry).filter(Boolean) as string[])].sort();
      for (const expiry of expiries) {
        const n = norms.find((x) => x.membershipExpiry === expiry)!;
        const covered = await tx.membership.findFirst({ where: { gymId, memberId: mid, startDate: { lte: toDbDate(expiry) }, endDate: { gte: toDbDate(expiry) } } });
        if (covered) continue;
        const plan = await resolvePlan(n.plan, n.planDays, n.amountPaisa);
        // Without a start date, count back one plan length from expiry — but it must still cover the
        // member's last recorded visit (and today): an expiry further out than one plan means they
        // paid ahead, and a membership "starting next month" would drop a current member from every count.
        const seen = norms.flatMap((x) => [x.lastVisit, x.visitDate, ...x.visits]).filter((d): d is string => !!d && d <= today).sort();
        const coverFrom = seen.at(-1) ?? today;
        const counted = addDays(expiry, -(plan.durationDays - 1));
        const start = n.membershipStart && n.membershipStart <= expiry ? n.membershipStart : counted > coverFrom ? coverFrom : counted;
        await tx.membership.create({
          data: {
            gymId,
            memberId: mid,
            planId: plan.id,
            startDate: toDbDate(start),
            endDate: toDbDate(expiry),
            pricePaisa: plan.pricePaisa || n.amountPaisa || 0,
            status: expiry >= today ? "ACTIVE" : "EXPIRED",
            source: "IMPORT",
          },
        });
      }

      // Attendance: every known visit date (never in the future). Existing days are left alone.
      const visits = [...new Set(norms.flatMap((n) => [n.lastVisit, n.visitDate, ...n.visits]).filter((d): d is string => !!d && d <= today))];
      if (visits.length) {
        await tx.attendance.createMany({
          data: visits.map((d) => ({ gymId, memberId: mid, localDate: toDbDate(d), checkedInAt: new Date(`${d}T06:00:00.000Z`), method: "IMPORT" as const, importJobId: jobId })),
          skipDuplicates: true,
        });
      }

      // Historical payments (recorded as imported, never as verified online payments).
      for (const r of groupRows) {
        const n = r.normalized as unknown as NormRow;
        if (!n.amountPaisa || !(n.paymentDate || n.membershipStart)) continue;
        const reference = `IMP-${jobId.slice(-8)}-${r.rowIndex}`;
        const exists = await tx.payment.findUnique({ where: { reference } });
        if (exists) continue;
        await tx.payment.create({
          data: {
            gymId,
            memberId: mid,
            purpose: "MEMBERSHIP",
            method: "IMPORTED",
            reference,
            amountPaisa: n.amountPaisa,
            status: "SUCCEEDED",
            source: "IMPORT",
            paidAt: new Date(`${n.paymentDate ?? n.membershipStart}T06:00:00.000Z`),
          },
        });
      }

      await tx.importRow.updateMany({ where: { id: { in: pending.map((r) => r.id) }, gymId }, data: { status: "IMPORTED", memberId: mid } });
    });
    touched.add(memberId!);
    importedRows += pending.length;
  }

  // Refresh denormalised engagement fields for everyone we touched.
  for (const ids of chunk([...touched], 100)) {
    const visits = await db.attendance.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, localDate: true, checkedInAt: true }, orderBy: { localDate: "asc" } });
    for (const id of ids) {
      const mine = visits.filter((v) => v.memberId === id);
      const days = mine.map((v) => fromDbDate(v.localDate));
      const s = streakFrom(days, today, streakGap(gym));
      await db.member.update({
        where: { id },
        data: { totalVisits: mine.length, lastAttendanceAt: mine.at(-1)?.checkedInAt ?? null, currentStreak: s.current, bestStreak: s.best },
      });
    }
  }

  const skipped = rows.filter((r) => !importable(r) && r.status !== "IMPORTED").map((r) => r.id);
  if (skipped.length) await db.importRow.updateMany({ where: { id: { in: skipped } }, data: { status: "SKIPPED" } });
  const updated = await refreshCounts(db, jobId, job.recordType);
  await db.importJob.update({ where: { id: jobId }, data: { status: "IMPORTED", completedAt: new Date() } });
  await audit({ actor: SYSTEM_ACTOR, action: "imports.committed", entityType: "ImportJob", entityId: jobId, gymId, after: { importedRows, membersCreated: created.length, membersUpdated: touched.size - created.length, skipped: skipped.length } });

  // Estimated churn report for the imported data (if the plan allows).
  const flags = await resolveFlags(gym);
  if (flags.churn_prediction && (await withinLimit(gymId, "predictionsPerMonth", gym.timezone))) {
    try {
      await generatePredictionReport(gymId, { source: "IMPORT", importJobId: jobId, createdById: job.createdById, qualityScore: updated.qualityScore });
    } catch (err) {
      log.error("import.prediction_failed", { err, jobId });
      await prisma.metricSample.create({ data: { name: "prediction.failed", value: 1, tags: { gymId, jobId } } });
    }
  }
  return { importedRows, membersCreated: created.length, membersUpdated: touched.size - created.length };
}

/** Called when an import job is dead-lettered so the UI shows a clear failure. */
export async function markImportFailed(gymId: string, jobId: string, message = "Something went wrong while processing your file.") {
  await tenantDb(gymId).importJob.updateMany({ where: { id: jobId, status: { in: ["PROCESSING", "IMPORTING"] } }, data: { status: "FAILED", errorMessage: message, completedAt: new Date() } });
}

export async function reprocessImport(gymId: string, jobId: string, actor: AuditActor) {
  const db = tenantDb(gymId);
  const job = await db.importJob.findUnique({ where: { id: jobId }, include: { file: true } });
  if (!job) throw notFound();
  if (job.status !== "FAILED") throw badRequest("Only failed imports can be reprocessed.");
  if (!job.file.storageKey) throw badRequest("The original file has been deleted under your retention policy. Please upload it again.");
  await db.importRow.deleteMany({ where: { importJobId: jobId } });
  await db.columnMapping.deleteMany({ where: { importJobId: jobId } });
  await db.dataQualityIssue.deleteMany({ where: { importJobId: jobId } });
  await db.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING", errorMessage: null, completedAt: null } });
  const ext = job.file.originalName.toLowerCase().split(".").pop() as AllowedExt;
  await enqueue("import.process", { jobId, gymId, ext }, { gymId, priority: 5, maxAttempts: 3 });
  await audit({ actor, action: "imports.reprocessed", entityType: "ImportJob", entityId: jobId, gymId });
}

/** Deletes the raw uploaded file now (the structured rows remain unless `purgeRows`). */
export async function deleteImportData(gymId: string, jobId: string, actor: AuditActor, purgeRows: boolean) {
  const db = tenantDb(gymId);
  const job = await db.importJob.findUnique({ where: { id: jobId }, include: { file: true } });
  if (!job) throw notFound();
  if (job.file.storageKey) await deleteStored(job.file.storageKey);
  await db.importedFile.update({ where: { id: job.fileId }, data: { storageKey: null, rawDeletedAt: new Date() } });
  if (purgeRows) {
    await db.importRow.updateMany({ where: { importJobId: jobId }, data: { raw: {}, normalized: {}, edited: undefined } });
    await db.importJob.update({ where: { id: jobId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  }
  await audit({ actor, action: purgeRows ? "imports.data_purged" : "imports.raw_deleted", entityType: "ImportJob", entityId: jobId, gymId });
}

/** Retention job: raw files past their expiry are deleted. */
export async function purgeExpiredRawFiles() {
  const files = await prisma.importedFile.findMany({ where: { rawDeletedAt: null, rawExpiresAt: { lt: new Date() } } });
  for (const f of files) {
    if (f.storageKey) await deleteStored(f.storageKey);
    await prisma.importedFile.update({ where: { id: f.id }, data: { storageKey: null, rawDeletedAt: new Date() } });
    await audit({ actor: SYSTEM_ACTOR, action: "imports.raw_expired", entityType: "ImportedFile", entityId: f.id, gymId: f.gymId });
  }
  return { deleted: files.length };
}

