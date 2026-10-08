/**
 * Pure row building: raw cells + column mappings (+ staff edits) → normalised member record,
 * issues, and a status. Kept free of I/O so the rules are unit-testable.
 */
import { addDays, isValidDateOnly, type DateOnly } from "@/lib/time";
import type { ImportRowStatus, IssueSeverity } from "@/generated/prisma/enums";
import { attendanceMark, bsToAd, cleanName, nameKey, parseAmount, parseDate, parseEmail, parseInteger, parsePhone, planDuration, type DateOrder } from "./normalize";
import type { TargetField } from "./mapping";

export type Mapping = { sourceIndex: number; sourceHeader: string; targetField: TargetField | string };

export type NormRow = {
  memberName: string | null;
  phone: string | null;
  email: string | null;
  memberCode: string | null;
  joinDate: DateOnly | null;
  lastVisit: DateOnly | null;
  visitDate: DateOnly | null;
  visitCount: number | null;
  plan: string | null;
  planDays: number | null;
  membershipStart: DateOnly | null;
  membershipExpiry: DateOnly | null;
  amountPaisa: number | null;
  paymentDate: DateOnly | null;
  visits: DateOnly[];
};

export type RowIssue = { field: string | null; type: string; severity: IssueSeverity; message: string };

export type BuildContext = {
  today: DateOnly;
  dateOrder: DateOrder;
  /** "2026-08" (AD) or "BS:2082-05" for day-number attendance registers */
  registerMonth: string | null;
  isMemberList: boolean;
};

export type Edits = Partial<Record<keyof NormRow, string>> & { __accepted?: boolean };

const LOW_CONFIDENCE = 70;
const DATE_FIELDS = ["joinDate", "lastVisit", "visitDate", "membershipStart", "membershipExpiry", "paymentDate"] as const;
const FIELD_LABEL: Record<string, string> = {
  memberName: "name",
  phone: "phone",
  email: "email",
  memberCode: "membership ID",
  joinDate: "join date",
  lastVisit: "last visit",
  visitDate: "visit date",
  membershipStart: "membership start",
  membershipExpiry: "expiry date",
  paymentDate: "payment date",
  amountPaisa: "amount",
  plan: "plan",
  visitCount: "visit count",
};

export function registerDate(month: string, day: number): DateOnly | null {
  if (month.startsWith("BS:")) {
    const [y, m] = month.slice(3).split("-").map(Number);
    return bsToAd(y!, m!, day);
  }
  const d = `${month}-${String(day).padStart(2, "0")}`;
  return isValidDateOnly(d) ? d : null;
}

export function buildRow(
  raw: unknown[],
  mappings: Mapping[],
  ctx: BuildContext,
  edits: Edits = {},
  cellConfidence?: number[],
): { norm: NormRow; issues: RowIssue[]; fieldConfidence: Record<string, number> | null; ambiguousDates: number; bsDates: number; unreadableMarks: number } {
  const norm: NormRow = {
    memberName: null, phone: null, email: null, memberCode: null, joinDate: null, lastVisit: null, visitDate: null,
    visitCount: null, plan: null, planDays: null, membershipStart: null, membershipExpiry: null, amountPaisa: null, paymentDate: null, visits: [],
  };
  const issues: RowIssue[] = [];
  const fieldConfidence: Record<string, number> = {};
  let ambiguousDates = 0;
  let bsDates = 0;
  let unreadableMarks = 0;
  const refYear = Number(ctx.today.slice(0, 4));

  const valueFor = (field: keyof NormRow): { value: unknown; conf: number | null; edited: boolean } => {
    if (edits[field] !== undefined) return { value: edits[field], conf: null, edited: true };
    const target = field === "amountPaisa" ? "amount" : field;
    const m = mappings.find((x) => x.targetField === target);
    if (!m) return { value: undefined, conf: null, edited: false };
    return { value: raw[m.sourceIndex], conf: cellConfidence?.[m.sourceIndex] ?? null, edited: false };
  };
  const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

  for (const field of ["memberName", "phone", "email", "memberCode", "plan", "visitCount", "amountPaisa", ...DATE_FIELDS] as const) {
    const { value, conf, edited } = valueFor(field);
    if (conf !== null && has(value)) {
      fieldConfidence[field] = conf;
      if (conf < LOW_CONFIDENCE && !edited) {
        issues.push({ field, type: "LOW_OCR_CONFIDENCE", severity: "WARNING", message: `We're not sure we read the ${FIELD_LABEL[field]} correctly ("${String(value)}")` });
      }
    }
    if (!has(value)) continue;
    switch (field) {
      case "memberName": {
        norm.memberName = cleanName(value);
        if (!norm.memberName) issues.push({ field, type: "INVALID_NAME", severity: "ERROR", message: `"${String(value)}" doesn't look like a name` });
        break;
      }
      case "phone": {
        const p = parsePhone(value);
        norm.phone = p.phone;
        if (p.invalid) issues.push({ field, type: "INVALID_PHONE", severity: "WARNING", message: `"${String(value)}" isn't a valid Nepal phone number` });
        break;
      }
      case "email": {
        const e = parseEmail(value);
        norm.email = e.email;
        if (e.invalid) issues.push({ field, type: "INVALID_EMAIL", severity: "WARNING", message: `"${String(value)}" isn't a valid email` });
        break;
      }
      case "memberCode":
        norm.memberCode = String(value).trim().slice(0, 40);
        break;
      case "plan":
        norm.plan = String(value).trim().slice(0, 60);
        norm.planDays = planDuration(value);
        break;
      case "visitCount":
        norm.visitCount = parseInteger(value);
        break;
      case "amountPaisa": {
        const a = parseAmount(value);
        norm.amountPaisa = a.paisa;
        if (a.invalid) issues.push({ field, type: "INVALID_AMOUNT", severity: "WARNING", message: `"${String(value)}" isn't a valid amount` });
        break;
      }
      default: {
        const d = parseDate(value, ctx.dateOrder, refYear);
        if (!d) {
          issues.push({ field, type: "INVALID_DATE", severity: "ERROR", message: `Couldn't read "${String(value)}" as a ${FIELD_LABEL[field]}` });
          break;
        }
        if (d.ambiguous) ambiguousDates++;
        if (d.fromBS) bsDates++;
        const future = d.date > ctx.today;
        const visitLike = field === "lastVisit" || field === "visitDate" || field === "joinDate" || field === "paymentDate";
        if (future && visitLike) {
          issues.push({ field, type: "FUTURE_DATE", severity: "ERROR", message: `The ${FIELD_LABEL[field]} (${d.date}) is in the future` });
          break;
        }
        if (d.date < "2000-01-01" || d.date > addDays(ctx.today, 800)) {
          issues.push({ field, type: "INVALID_DATE", severity: "ERROR", message: `The ${FIELD_LABEL[field]} (${d.date}) is out of range` });
          break;
        }
        norm[field] = d.date;
      }
    }
  }

  // Attendance register day columns
  for (const m of mappings) {
    const t = String(m.targetField);
    if (!t.startsWith("day:") && !t.startsWith("date:")) continue;
    const mark = attendanceMark(raw[m.sourceIndex]);
    if (mark === null) {
      unreadableMarks++;
      continue;
    }
    if (!mark) continue;
    const date = t.startsWith("date:") ? t.slice(5) : ctx.registerMonth ? registerDate(ctx.registerMonth, Number(t.slice(4))) : null;
    if (date && date <= ctx.today) norm.visits.push(date);
  }
  if (unreadableMarks > 0) {
    issues.push({ field: "visits", type: "UNREADABLE_MARKS", severity: "WARNING", message: `${unreadableMarks} attendance mark${unreadableMarks === 1 ? "" : "s"} couldn't be read` });
  }
  norm.visits = [...new Set(norm.visits)].sort();

  if (!norm.memberName && !norm.phone && !norm.memberCode) {
    issues.push({ field: "memberName", type: "MISSING_IDENTITY", severity: "ERROR", message: "No name, phone or membership ID — we can't tell who this is" });
  }
  if (ctx.isMemberList && !norm.lastVisit && !norm.visitDate && norm.visits.length === 0 && norm.visitCount === null) {
    issues.push({ field: "lastVisit", type: "MISSING_ATTENDANCE", severity: "WARNING", message: "No attendance information for this member" });
  }
  if (norm.membershipStart && norm.membershipExpiry && norm.membershipStart > norm.membershipExpiry) {
    issues.push({ field: "membershipExpiry", type: "INVALID_DATE", severity: "ERROR", message: "Expiry is before the start date" });
    norm.membershipExpiry = null;
  }

  return { norm, issues, fieldConfidence: Object.keys(fieldConfidence).length ? fieldConfidence : null, ambiguousDates, bsDates, unreadableMarks };
}

export function statusFor(issues: RowIssue[], accepted: boolean): ImportRowStatus {
  if (issues.some((i) => i.type === "MISSING_IDENTITY" || i.type === "INVALID_NAME")) return "INVALID";
  if (accepted) return "CLEAN";
  if (issues.length) return "NEEDS_REVIEW";
  return "CLEAN";
}

/** Stable identity used to group rows that describe the same person within a file. */
export function identityKey(n: Pick<NormRow, "memberCode" | "phone" | "email" | "memberName">): string | null {
  if (n.memberCode) return `code:${n.memberCode.toLowerCase()}`;
  if (n.phone) return `phone:${n.phone}`;
  if (n.email) return `email:${n.email}`;
  const k = nameKey(n.memberName);
  return k ? `name:${k}` : null;
}

export type ExistingMember = { id: string; memberCode: string; fullName: string; phone: string | null; email: string | null };

export type DuplicateMatch = { duplicateOfId: string; reason: string; strong: boolean };

/** Duplicate detection against existing members: membership ID, phone, email, then name+phone. */
export function matchExisting(n: NormRow, index: {
  byCode: Map<string, ExistingMember>;
  byPhone: Map<string, ExistingMember>;
  byEmail: Map<string, ExistingMember>;
  byName: Map<string, ExistingMember[]>;
}): DuplicateMatch | null {
  const label = (m: ExistingMember) => `${m.fullName} (${m.memberCode})`;
  if (n.memberCode) {
    const m = index.byCode.get(n.memberCode.toLowerCase());
    if (m) return { duplicateOfId: m.id, reason: `Same membership ID as ${label(m)}`, strong: true };
  }
  if (n.phone) {
    const m = index.byPhone.get(n.phone);
    if (m) return { duplicateOfId: m.id, reason: `Same phone as ${label(m)}`, strong: true };
  }
  if (n.email) {
    const m = index.byEmail.get(n.email);
    if (m) return { duplicateOfId: m.id, reason: `Same email as ${label(m)}`, strong: true };
  }
  const byName = index.byName.get(nameKey(n.memberName)) ?? [];
  if (byName.length && !n.phone && !n.memberCode) {
    return { duplicateOfId: byName[0]!.id, reason: `Same name as ${label(byName[0]!)} (no phone to confirm)`, strong: false };
  }
  return null;
}

export function indexExisting(members: ExistingMember[]) {
  const byCode = new Map<string, ExistingMember>();
  const byPhone = new Map<string, ExistingMember>();
  const byEmail = new Map<string, ExistingMember>();
  const byName = new Map<string, ExistingMember[]>();
  for (const m of members) {
    byCode.set(m.memberCode.toLowerCase(), m);
    if (m.phone) byPhone.set(m.phone, m);
    if (m.email) byEmail.set(m.email.toLowerCase(), m);
    const k = nameKey(m.fullName);
    if (k) byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  return { byCode, byPhone, byEmail, byName };
}
