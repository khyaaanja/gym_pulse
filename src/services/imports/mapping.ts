/**
 * Smart column mapping. Headers on real gym sheets are anything but standard
 * ("Customer Name", "Mob. No.", "Package", "Expire", "Last Seen", day numbers 1–31…),
 * so each column is scored by (a) header synonyms and (b) what its values look like.
 * Every suggestion carries a confidence and is editable in the review screen.
 */
import { attendanceMark, parseAmount, parseDate, parseEmail, parsePhone, planDuration } from "./normalize";

export const TARGET_FIELDS = {
  memberName: "Member Name",
  phone: "Phone",
  email: "Email",
  memberCode: "Membership ID",
  joinDate: "Join Date",
  lastVisit: "Last Attendance",
  visitDate: "Visit Date",
  visitCount: "Visit Count",
  plan: "Membership Plan",
  membershipStart: "Membership Start",
  membershipExpiry: "Membership Expiry",
  amount: "Amount",
  paymentDate: "Payment Date",
  ignore: "Don't import",
} as const;

export type TargetField = keyof typeof TARGET_FIELDS | `day:${number}` | `date:${string}`;

export const TARGET_OPTIONS = Object.entries(TARGET_FIELDS).map(([value, label]) => ({ value, label }));

const SYNONYMS: Record<keyof typeof TARGET_FIELDS, string[]> = {
  memberName: ["name", "membername", "member", "customer", "customername", "client", "clientname", "fullname", "nameofmember", "participant", "naam", "नाम", "sadasya"],
  phone: ["phone", "mobile", "contact", "contactno", "contactnumber", "phoneno", "phonenumber", "mobileno", "mobilenumber", "cell", "cellno", "mob", "mobno", "ph", "tel", "telephone", "फोन", "मोबाइल", "sampark"],
  email: ["email", "emailaddress", "mail", "emailid"],
  memberCode: ["memberid", "membershipid", "memberno", "membernumber", "id", "code", "membercode", "cardno", "cardnumber", "regno", "registrationno", "rollno", "idno"],
  joinDate: ["joindate", "joined", "joiningdate", "dateofjoining", "admissiondate", "membersince", "datejoined", "doj", "enrolled"],
  lastVisit: ["lastvisit", "lastseen", "lastattendance", "lastcheckin", "lastcame", "lastvisited", "lastpresent"],
  visitDate: ["date", "visitdate", "attendancedate", "checkindate", "checkin", "checkedin", "day", "visit", "intime", "entrydate"],
  visitCount: ["visits", "totalvisits", "attendancecount", "dayspresent", "presentdays", "noofvisits", "totalpresent", "present", "count", "attendance"],
  plan: ["plan", "package", "membership", "membershiptype", "type", "scheme", "packagename", "plantype", "subscription", "category"],
  membershipStart: ["start", "startdate", "from", "validfrom", "renewaldate", "renewedon", "fromdate", "membershipstart"],
  membershipExpiry: ["expiry", "expire", "expires", "expirydate", "expiredate", "enddate", "validtill", "validuntil", "duedate", "renewaldue", "to", "todate", "till", "expiryon", "membershipexpiry"],
  amount: ["amount", "fee", "fees", "paid", "payment", "amountpaid", "price", "rs", "npr", "total", "monthlyfee", "charge"],
  paymentDate: ["paymentdate", "paidon", "paiddate", "receiptdate", "dateofpayment", "billdate"],
  ignore: ["sn", "sno", "serial", "serialno", "snno", "remarks", "remark", "note", "notes", "signature", "sign", "sig", "address", "gender", "sex", "age", "dob", "dateofbirth", "blood", "bloodgroup"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

export function headerScore(header: string): { field: keyof typeof TARGET_FIELDS; score: number } | null {
  const h = norm(header);
  if (!h) return null;
  let best: { field: keyof typeof TARGET_FIELDS; score: number } | null = null;
  for (const [field, syns] of Object.entries(SYNONYMS) as [keyof typeof TARGET_FIELDS, string[]][]) {
    for (const s of syns) {
      let score = h === s ? 1 : h.includes(s) && s.length >= 4 ? 0.85 : dice(h, s);
      // "Last Visit Date" should prefer lastVisit over visitDate.
      if (field === "lastVisit" && h.startsWith("last")) score = Math.max(score, 0.9);
      if (!best || score > best.score) best = { field, score };
    }
  }
  return best && best.score >= 0.72 ? best : null;
}

/** A header like "1", "15", "01/08" or "2026-08-15" in an attendance register. */
export function dayHeader(header: string, order: "DMY" | "MDY" | "YMD" = "DMY"): TargetField | null {
  const h = header.trim();
  if (/^\d{1,2}$/.test(h)) {
    const n = Number(h);
    return n >= 1 && n <= 31 ? `day:${n}` : null;
  }
  const d = parseDate(h, order);
  if (d && /[-/.\s]/.test(h)) return `date:${d.date}`;
  return null;
}

type Profile = { phone: number; email: number; date: number; amount: number; plan: number; mark: number; name: number; numeric: number; filled: number };

function profile(values: unknown[]): Profile {
  const vals = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  const n = vals.length || 1;
  const share = (fn: (v: unknown) => boolean) => vals.filter(fn).length / n;
  return {
    phone: share((v) => !parsePhone(v).invalid && !!parsePhone(v).phone),
    email: share((v) => !!parseEmail(v).email),
    date: share((v) => !!parseDate(v)),
    amount: share((v) => {
      const a = parseAmount(v).paisa;
      return a !== null && a >= 10_000 && a <= 20_000_000;
    }),
    plan: share((v) => planDuration(v) !== null),
    mark: share((v) => attendanceMark(v) !== null && String(v).trim().length <= 3),
    name: share((v) => typeof v === "string" && /^[\p{L}\s.'-]{3,}$/u.test(v.trim()) && /\s/.test(v.trim())),
    numeric: share((v) => /^\d+$/.test(String(v).trim())),
    filled: vals.length / Math.max(1, values.length),
  };
}

export type ColumnSuggestion = { index: number; header: string; target: TargetField; confidence: number };

/** Picks the header row: the one among the first 15 with the most recognisable header cells. */
export function detectHeaderRow(grid: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(15, grid.length); r++) {
    const row = grid[r] ?? [];
    const nonEmpty = row.filter((c) => String(c ?? "").trim() !== "");
    if (nonEmpty.length < 2) continue;
    const hits = row.filter((c) => headerScore(String(c ?? "")) || dayHeader(String(c ?? ""))).length;
    const textual = nonEmpty.filter((c) => typeof c === "string" && !/^\d+([.,]\d+)?$/.test(c.trim())).length / nonEmpty.length;
    const score = hits * 2 + textual;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function suggestMappings(headers: string[], sample: unknown[][], order: "DMY" | "MDY" | "YMD" = "DMY"): ColumnSuggestion[] {
  const used = new Set<string>();
  const out: ColumnSuggestion[] = headers.map((header, index) => {
    const values = sample.map((r) => r[index]);
    const day = dayHeader(header, order);
    const p = profile(values);
    if (day && (p.mark >= 0.5 || p.filled < 0.3)) return { index, header, target: day, confidence: 0.9 };
    const byHeader = headerScore(header);
    if (byHeader) {
      // Sanity-check the header against the data: "Contact" holding emails is really email.
      if (byHeader.field === "phone" && p.email > 0.6) return { index, header, target: "email", confidence: 0.8 };
      if (byHeader.field === "memberCode" && p.phone > 0.8) return { index, header, target: "phone", confidence: 0.75 };
      return { index, header, target: byHeader.field, confidence: Math.round(byHeader.score * 100) / 100 };
    }
    if (p.filled < 0.05) return { index, header, target: "ignore", confidence: 0.5 };
    if (p.phone > 0.6) return { index, header, target: "phone", confidence: 0.7 };
    if (p.email > 0.6) return { index, header, target: "email", confidence: 0.75 };
    if (p.plan > 0.6) return { index, header, target: "plan", confidence: 0.6 };
    if (p.date > 0.6) return { index, header, target: "visitDate", confidence: 0.45 };
    if (p.amount > 0.6) return { index, header, target: "amount", confidence: 0.5 };
    if (p.name > 0.6) return { index, header, target: "memberName", confidence: 0.55 };
    return { index, header, target: "ignore", confidence: 0.3 };
  });
  // A single-valued field can only be mapped once; keep the most confident column.
  const singles = out.filter((c) => !String(c.target).includes(":") && c.target !== "ignore").sort((a, b) => b.confidence - a.confidence);
  for (const c of singles) {
    if (used.has(c.target)) {
      c.target = "ignore";
      c.confidence = 0.3;
    } else used.add(c.target);
  }
  return out;
}

export type RecordType = "MEMBER_LIST" | "ATTENDANCE_LOG" | "ATTENDANCE_GRID" | "PAYMENTS" | "UNKNOWN";

export function detectRecordType(mappings: { target: TargetField }[], rows: Record<string, unknown>[]): RecordType {
  const targets = new Set(mappings.map((m) => m.target));
  const dayCols = mappings.filter((m) => String(m.target).startsWith("day:") || String(m.target).startsWith("date:")).length;
  const hasIdentity = targets.has("memberName") || targets.has("phone") || targets.has("memberCode");
  if (!hasIdentity) return "UNKNOWN";
  if (dayCols >= 5) return "ATTENDANCE_GRID";
  if (targets.has("visitDate")) {
    const keys = rows.map((r) => String(r.memberCode ?? r.phone ?? r.memberName ?? "").toLowerCase()).filter(Boolean);
    const distinct = new Set(keys).size;
    if (keys.length > 0 && distinct < keys.length * 0.8) return "ATTENDANCE_LOG";
    if (!targets.has("membershipExpiry") && !targets.has("plan")) return "ATTENDANCE_LOG";
  }
  if (targets.has("amount") && targets.has("paymentDate") && !targets.has("membershipExpiry") && !targets.has("lastVisit")) return "PAYMENTS";
  return "MEMBER_LIST";
}
