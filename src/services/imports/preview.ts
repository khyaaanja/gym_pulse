/**
 * Records check without an account: the same reading and the same Risk Engine as a real import, run
 * entirely in memory. Nothing is stored — no file, no rows, no members, no report — so a prospective owner
 * can see what GymPulse finds in their register before signing up.
 *
 * Mirrors three stages of the logged-in path, each noted where it is copied:
 *   processImport/rebuildRows  → read the file, map columns, build rows
 *   commitImport               → group rows into members, derive memberships and visits
 *   loadMemberInputs/generatePredictionReport → measure risk, confidence and the estimate range
 * What a real import has that this can't: staff review of unclear rows, duplicate decisions against existing
 * members, and the gym's own settings (the platform defaults are used).
 */
import { gymSettings } from "@/config/gym-settings";
import { predictionConfigFor } from "@/config/prediction";
import { badRequest } from "@/lib/errors";
import { monthlyEquivalent } from "@/lib/money";
import { addDays, diffDays, today as todayIn, type DateOnly } from "@/lib/time";
import { assessMember, confidenceOf, forecast, recommendedAction, type MemberInput } from "../risk/engine";
import { loadCalibration } from "../risk/run";
import { sanitizeFilename, validateUpload } from "./detect";
import { detectHeaderRow, detectRecordType, suggestMappings, type TargetField } from "./mapping";
import { parseToGrid, ParseError } from "./parse";
import { guessRegisterMonth } from "./register-month";
import { buildRow, identityKey, statusFor, type Mapping, type NormRow } from "./rows";
import { scanBuffer } from "./scan";

export const PREVIEW_MAX_FILES = 6;
const WATCHLIST_MAX = 50;

export type PreviewFile = { name: string; type: string; data: Buffer };

type Person = { key: string; norms: NormRow[] };

export async function analyzeRecords(files: PreviewFile[], today: DateOnly = todayIn()) {
  if (files.length === 0) throw badRequest("Choose a file to check.");
  if (files.length > PREVIEW_MAX_FILES) throw badRequest(`Check up to ${PREVIEW_MAX_FILES} files at a time.`);
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

  const people = new Map<string, Person>();
  const notes: string[] = [];
  const read: { name: string; rows: number; recordType: string; registerMonth: string | null }[] = [];
  let totalRows = 0, cleanRows = 0, unreadableRows = 0;

  for (const file of files) {
    const name = sanitizeFilename(file.name);
    if (file.data.length === 0) throw badRequest(`${name} is empty.`);
    if (file.data.length > maxBytes) throw badRequest(`Files can be up to ${process.env.MAX_UPLOAD_MB ?? 10} MB.`);
    const v = validateUpload(file.name, file.type, file.data);
    if ("error" in v) throw badRequest(`${name}: ${v.error}`);
    if (v.kind === "IMAGE") throw badRequest("Photos can be read after you sign up. For the free check, upload a CSV, Excel or PDF file.");
    const scan = await scanBuffer(file.data);
    if (scan.status === "INFECTED") throw badRequest(`${name} was blocked by our security scan.`);

    // ── as processImport ──
    let grid;
    try {
      grid = await parseToGrid(v.ext, file.data);
    } catch (err) {
      if (err instanceof ParseError) throw badRequest(`${name}: ${err.message}`);
      throw err;
    }
    const headerIdx = detectHeaderRow(grid.rows);
    const headers = (grid.rows[headerIdx] ?? []).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
    const body = grid.rows.slice(headerIdx + 1);
    const settings = gymSettings({});
    const mappings: Mapping[] = suggestMappings(headers, body.slice(0, 200), settings.imports.dateOrder).map((s) => ({ sourceIndex: s.index, sourceHeader: s.header, targetField: s.target }));
    const needsMonth = mappings.some((m) => String(m.targetField).startsWith("day:"));
    const reg = needsMonth ? guessRegisterMonth([file.name, grid.sheetName, ...headers], today) : null;
    if (reg?.assumed) notes.push(`${name}: we couldn't tell which month this register covers, so we assumed ${reg.month.replace("BS:", "BS ")}. To be sure, put the month in the file name, for example "Register August 2026".`);
    notes.push(...grid.notes.map((n) => `${name}: ${n}`));

    // ── as rebuildRows ──
    const preview = body.slice(0, 300).map((cells) => {
      const o: Record<string, unknown> = {};
      for (const m of mappings) if (!String(m.targetField).includes(":")) o[m.targetField] = cells[m.sourceIndex];
      return o;
    });
    const recordType = detectRecordType(mappings.map((m) => ({ target: m.targetField as TargetField })), preview);
    const ctx = { today, dateOrder: settings.imports.dateOrder, registerMonth: reg?.month ?? null, isMemberList: recordType === "MEMBER_LIST" };

    for (const [i, cells] of body.entries()) {
      const b = buildRow(cells, mappings, ctx);
      totalRows++;
      const status = statusFor(b.issues, false);
      if (status === "INVALID") { unreadableRows++; continue; }
      if (status === "CLEAN") cleanRows++;
      // Rows for the same person (membership ID, phone, email, else name) are one member — across files too, so
      // several monthly registers join up into one history.
      const key = identityKey(b.norm) ?? `row:${name}:${i}`;
      const p = people.get(key) ?? { key, norms: [] };
      p.norms.push(b.norm);
      people.set(key, p);
    }
    read.push({ name, rows: body.length, recordType, registerMonth: reg?.month ?? null });
  }
  if (unreadableRows) notes.push(`${unreadableRows === 1 ? "1 row" : `${unreadableRows} rows`} had no name, phone or membership ID and ${unreadableRows === 1 ? "was" : "were"} left out.`);

  // ── as commitImport: one member per person, memberships from expiry dates, visits never in the future ──
  const members = [...people.values()].map((p, idx) => {
    const pick = <K extends keyof NormRow>(k: K) => p.norms.map((n) => n[k]).find((v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) ?? null;
    const visits = [...new Set(p.norms.flatMap((n) => [n.lastVisit, n.visitDate, ...n.visits]).filter((d): d is string => !!d && d <= today))].sort();
    const joined = (pick("joinDate") as string | null) ?? (pick("membershipStart") as string | null) ?? visits[0] ?? today;
    const expiries = [...new Set(p.norms.map((n) => n.membershipExpiry).filter(Boolean) as string[])].sort();
    const memberships = expiries.map((expiry) => {
      const n = p.norms.find((x) => x.membershipExpiry === expiry)!;
      const days = n.planDays ?? 30;
      const coverFrom = visits.at(-1) ?? today;
      const counted = addDays(expiry, -(days - 1));
      const start = n.membershipStart && n.membershipStart <= expiry ? n.membershipStart : counted > coverFrom ? coverFrom : counted;
      return { start, end: expiry, monthlyFeePaisa: monthlyEquivalent(n.amountPaisa ?? 0, days) };
    });
    return { id: `m${idx}`, name: (pick("memberName") as string | null) ?? "Unnamed member", joined, joinDateKnown: !!pick("joinDate"), visits, memberships };
  });

  // ── as riskAsOf: uploaded records only, so measure as of the last day in them, not today ──
  const allVisits = members.flatMap((m) => m.visits);
  const lastDay = allVisits.length ? allVisits.reduce((a, b) => (a > b ? a : b)) : null;
  const asOf = lastDay && lastDay < today ? lastDay : today;
  const firstDay = allVisits.length ? allVisits.reduce((a, b) => (a < b ? a : b)) : null;

  // ── as loadMemberInputs ──
  const cfg = await predictionConfigFor(null);
  const windowStart = addDays(asOf, -cfg.analysisWindowDays);
  const inputs: MemberInput[] = members.map((m) => {
    const active = m.memberships.filter((x) => x.start <= asOf && x.end >= asOf).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    const ended = m.memberships.filter((x) => x.end < asOf).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    const seen = m.visits.filter((d) => d <= asOf);
    return {
      memberId: m.id,
      today: asOf,
      joinedOn: m.joined,
      visits: seen.filter((d) => d > windowStart),
      lastVisit: seen.at(-1) ?? null,
      active: active ? { startDate: active.start, endDate: active.end, monthlyFeePaisa: active.monthlyFeePaisa } : null,
      lastEndedOn: active ? null : ended?.end ?? null,
      renewals: 0,
      // The "join date" of a member without one is just their first visit in the file: renewal history is unknown.
      renewalKnown: m.joinDateKnown || !m.visits.length || m.joined < m.visits[0]!,
    };
  });
  const attendanceRecords = inputs.reduce((a, i) => a + i.visits.length, 0);

  // ── as generatePredictionReport ──
  const calibration = await loadCalibration();
  const assessments = inputs.map((i) => assessMember(i, cfg, calibration));
  const withMembership = assessments.filter((a) => a.monthlyFeePaisa > 0 || a.signals.daysSinceExpiry !== null);
  const historyDays = firstDay ? Math.min(cfg.analysisWindowDays, diffDays(firstDay, asOf)) : 0;
  const qualityScore = totalRows ? Math.round((cleanRows / totalRows) * 100) : null;
  const conf = confidenceOf({ membersAnalyzed: withMembership.length, attendanceRecords, historyDays, qualityScore, calibrated: !!calibration }, cfg);
  const fc = conf.level === "INSUFFICIENT" ? null : forecast(assessments, cfg, gymSettings({}).renewal.gracePeriodDays, conf.level, !!calibration);
  const fees = assessments.map((a) => a.monthlyFeePaisa).filter((f) => f > 0);
  const avgFee = fees.length ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : 0;

  const live = assessments.filter((a) => a.riskStatus !== "LOST");
  const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
  const byId = new Map(members.map((m) => [m.id, m]));
  const flagged = assessments
    // Members the engine says to act on, plus anyone paid up and 10+ days away. A small dip that only earns a
    // "needs attention" status with "no action needed" isn't worth a call, so it stays off the list.
    .filter((a) => a.recommendedAction !== recommendedAction("LOW", "ACTIVE") || a.riskStatus === "AT_RISK")
    .sort((a, b) => b.score - a.score);

  return {
    asOf,
    recordsEndBeforeToday: asOf < today,
    files: read,
    notes,
    rows: { total: totalRows, clean: cleanRows, unreadable: unreadableRows, qualityScore },
    membersFound: members.length,
    membersAnalyzed: withMembership.length,
    attendanceRecords,
    historyDays,
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    insufficientReason: conf.insufficientReason,
    estimate: fc && {
      atRisk: fc.estimatedAtRisk,
      atRiskLow: fc.rangeLow,
      atRiskHigh: fc.rangeHigh,
      leaving: fc.estimatedLoss,
      leavingLow: fc.lossLow,
      leavingHigh: fc.lossHigh,
      averageFeePaisa: avgFee,
      monthlyExposureLowPaisa: fc.rangeLow * avgFee,
      monthlyExposureHighPaisa: fc.rangeHigh * avgFee,
    },
    status: {
      active: count(assessments, (a) => a.riskStatus === "ACTIVE"),
      attention: count(assessments, (a) => a.riskStatus === "ATTENTION"),
      atRisk: count(assessments, (a) => a.riskStatus === "AT_RISK"),
      lost: count(assessments, (a) => a.riskStatus === "LOST"),
    },
    drivers: {
      declining: count(live, (a) => (a.signals.declinePct ?? 0) >= 0.4 && a.signals.visitsPrev30 >= 4),
      expiringSoon: count(live, (a) => a.signals.daysToExpiry !== null && a.signals.daysToExpiry <= cfg.forecastHorizonDays),
      longGap: count(live, (a) => a.signals.daysSinceLastVisit >= cfg.inactivityThresholdDays),
    },
    thresholds: { inactivityDays: cfg.inactivityThresholdDays, horizonDays: cfg.forecastHorizonDays },
    watchlist: flagged.slice(0, WATCHLIST_MAX).map((a) => {
      const m = byId.get(a.memberId)!;
      return {
        name: m.name,
        score: a.score,
        category: a.category,
        status: a.riskStatus,
        lastVisit: m.visits.filter((d) => d <= asOf).at(-1) ?? null,
        daysSinceLastVisit: a.signals.daysSinceLastVisit,
        daysToExpiry: a.signals.daysToExpiry,
        monthlyFeePaisa: a.monthlyFeePaisa,
        reasons: a.factors.filter((f) => f.contribution > 0).slice(0, 3).map((f) => f.detail),
        action: a.recommendedAction,
        // Visits per day over the last six weeks, for a small attendance strip.
        recent: Array.from({ length: 42 }, (_, i): number => (m.visits.includes(addDays(asOf, i - 41)) ? 1 : 0)),
      };
    }),
    watchlistTotal: flagged.length,
  };
}

export type RecordsCheck = Awaited<ReturnType<typeof analyzeRecords>>;
