import type { RecoveryEventType } from "@/generated/prisma/client";
import { tenantDb } from "@/db/tenant";
import { fromDbDate, toDbDate } from "@/lib/time";
import type { Range } from "./analytics";

/** CSV cell escaping, including spreadsheet formula-injection protection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise anything a spreadsheet would run as a formula — but a plain negative number (a refund, a discount)
  // is data, not a formula, and must stay a number.
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const REPORTS = {
  members: "Member report",
  attendance: "Attendance report",
  renewals: "Renewal report",
  churn: "Churn report",
  risk: "Risk report (estimates)",
  recovery: "Recovery report",
  revenue: "Revenue report",
  marketplace: "Marketplace report",
  payments: "Payment report",
  imports: "Import report",
} as const;
export type ReportKey = keyof typeof REPORTS;

const d = (x: Date | null | undefined) => (x ? fromDbDate(x) : "");
const rs = (p: number | null | undefined) => (p === null || p === undefined ? "" : (p / 100).toFixed(2));

const CONTACT_EVENTS: RecoveryEventType[] = ["MESSAGE_SENT", "CALLED", "WHATSAPP_OPENED", "MARKED_CONTACTED"];
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
/** Tasks that were open at any point in the period: opened before it ended, and not closed before it began. */
const recoveryWindow = (from: Date, toEnd: Date) => ({ createdAt: { lt: toEnd }, OR: [{ closedAt: null }, { closedAt: { gte: from } }] });

export type RecoverySummary = {
  tasks: number; contacted: number; returned: number; renewed: number; lost: number; open: number;
  contactRate: number | null; returnRate: number | null; medianDaysToReturn: number | null;
  protectedRevenuePaisa: number; failedMessages: number;
  byMethod: { method: string; tasks: number; returned: number }[];
};

/**
 * On-screen recovery report for the same window as the CSV. Rates are over tasks that reached an
 * outcome or were contacted — an untouched task doesn't count as a failure of any channel.
 */
export async function recoverySummary(gymId: string, range: Range): Promise<RecoverySummary> {
  const db = tenantDb(gymId);
  const from = toDbDate(range.from);
  const toEnd = new Date(toDbDate(range.to).getTime() + 86_400_000);
  const where = recoveryWindow(from, toEnd);
  const [tasks, failedMessages] = await Promise.all([
    db.recoveryTask.findMany({ where, select: { status: true, createdAt: true, returnedAt: true, recoveredAt: true, lastContactAt: true, contactMethod: true, protectedRevenuePaisa: true } }),
    db.recoveryEvent.count({ where: { type: "MESSAGE_NOT_SENT", createdAt: { gte: from, lt: toEnd } } }),
  ]);
  const came = (t: (typeof tasks)[number]) => t.status === "RETURNED" || t.status === "RENEWED" || !!t.returnedAt;
  const contacted = tasks.filter((t) => t.lastContactAt || t.status !== "NOT_CONTACTED").length;
  const returned = tasks.filter(came).length;
  const days = tasks.filter((t) => t.returnedAt).map((t) => daysBetween(t.createdAt, t.returnedAt!)).sort((a, b) => a - b);
  const methods = new Map<string, { tasks: number; returned: number }>();
  for (const t of tasks) {
    if (!t.contactMethod) continue;
    const m = methods.get(t.contactMethod) ?? { tasks: 0, returned: 0 };
    m.tasks++;
    if (came(t)) m.returned++;
    methods.set(t.contactMethod, m);
  }
  return {
    tasks: tasks.length,
    contacted,
    returned,
    renewed: tasks.filter((t) => t.status === "RENEWED" || t.recoveredAt).length,
    lost: tasks.filter((t) => t.status === "LOST").length,
    open: tasks.filter((t) => ["NOT_CONTACTED", "CONTACTED", "FOLLOW_UP"].includes(t.status)).length,
    contactRate: tasks.length ? contacted / tasks.length : null,
    returnRate: contacted ? tasks.filter((t) => came(t) && (t.lastContactAt || t.status !== "NOT_CONTACTED")).length / contacted : null,
    medianDaysToReturn: days.length ? days[Math.floor((days.length - 1) / 2)]! : null,
    protectedRevenuePaisa: tasks.reduce((a, t) => a + (t.protectedRevenuePaisa ?? 0), 0),
    failedMessages,
    byMethod: [...methods].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.tasks - a.tasks),
  };
}

export async function buildReport(gymId: string, key: ReportKey, range: Range): Promise<{ filename: string; csv: string }> {
  const db = tenantDb(gymId);
  const from = toDbDate(range.from);
  const to = toDbDate(range.to);
  const toEnd = new Date(to.getTime() + 86_400_000);
  const LIMIT = 50_000;
  let headers: string[] = [];
  let rows: unknown[][] = [];
  switch (key) {
    case "members": {
      const ms = await db.member.findMany({ where: { archivedAt: null }, orderBy: { fullName: "asc" }, take: LIMIT, include: { memberships: { orderBy: { endDate: "desc" }, take: 1, include: { plan: true } } } });
      headers = ["Member ID", "Name", "Phone", "Email", "Joined", "Status", "Risk status", "Plan", "Expiry", "Last visit", "Total visits", "Current streak"];
      rows = ms.map((m) => [m.memberCode, m.fullName, m.phone, m.email, d(m.joinedOn), m.status, m.riskStatus, m.memberships[0]?.plan.name, d(m.memberships[0]?.endDate), m.lastAttendanceAt?.toISOString().slice(0, 10), m.totalVisits, m.currentStreak]);
      break;
    }
    case "attendance": {
      const a = await db.attendance.findMany({ where: { localDate: { gte: from, lte: to } }, include: { member: { select: { memberCode: true, fullName: true } }, location: { select: { name: true } } }, orderBy: { checkedInAt: "asc" }, take: LIMIT });
      headers = ["Date", "Time (UTC)", "Member ID", "Name", "Method", "Branch"];
      rows = a.map((x) => [d(x.localDate), x.checkedInAt.toISOString().slice(11, 16), x.member.memberCode, x.member.fullName, x.method, x.location?.name]);
      break;
    }
    case "renewals": {
      const ms = await db.membership.findMany({ where: { endDate: { gte: from, lte: to } }, include: { member: true, plan: true, renewedTo: true }, orderBy: { endDate: "asc" }, take: LIMIT });
      headers = ["Member ID", "Name", "Plan", "Start", "End", "Price (NPR)", "Renewed", "Renewed until"];
      rows = ms.map((m) => [m.member.memberCode, m.member.fullName, m.plan.name, d(m.startDate), d(m.endDate), rs(m.pricePaisa), m.renewedTo ? "Yes" : "No", d(m.renewedTo?.endDate)]);
      break;
    }
    case "churn": {
      const h = await db.riskHistory.findMany({ where: { changedAt: { gte: from, lt: toEnd } }, include: { member: { select: { memberCode: true, fullName: true } } }, orderBy: { changedAt: "asc" }, take: LIMIT });
      headers = ["Date", "Member ID", "Name", "From", "To", "Score", "Reason"];
      rows = h.map((x) => [x.changedAt.toISOString().slice(0, 10), x.member.memberCode, x.member.fullName, x.fromStatus, x.toStatus, x.score, x.reason]);
      break;
    }
    case "risk": {
      const report = await db.predictionReport.findFirst({ orderBy: { generatedAt: "desc" } });
      const a = report ? await db.riskAssessment.findMany({ where: { reportId: report.id }, include: { member: { select: { memberCode: true, fullName: true, phone: true } } }, orderBy: { score: "desc" }, take: LIMIT }) : [];
      headers = ["Report date", "Model", "Member ID", "Name", "Phone", "Estimated risk", "Score (0-100)", "Estimated likelihood", "Days since visit", "Visits last 30d", "Visits prev 30d", "Days to expiry", "Monthly fee (NPR)", "Main reasons", "Recommended action"];
      rows = a.map((x) => [report!.generatedAt.toISOString().slice(0, 10), x.modelVersion, x.member.memberCode, x.member.fullName, x.member.phone, x.category, x.score, x.likelihood.toFixed(2), x.daysSinceLastVisit, x.visitsLast30, x.visitsPrev30, x.daysToExpiry, rs(x.monthlyFeePaisa), (x.factors as { detail: string }[]).map((f) => f.detail).join("; "), x.recommendedAction]);
      break;
    }
    case "recovery": {
      const t = await db.recoveryTask.findMany({ where: recoveryWindow(from, toEnd), include: { member: { select: { memberCode: true, fullName: true, phone: true } }, assignedTo: { include: { user: { select: { name: true } } } }, _count: { select: { events: { where: { type: { in: CONTACT_EVENTS } } } } } }, orderBy: { createdAt: "asc" }, take: LIMIT });
      headers = ["Opened", "Member ID", "Name", "Phone", "Reason", "Assigned to", "Status", "Contact attempts", "Last contact", "Method", "Result", "Returned", "Days to return", "Renewed", "Closed", "Monthly fee (NPR)", "Est. protected revenue (NPR)"];
      rows = t.map((x) => [x.createdAt.toISOString().slice(0, 10), x.member.memberCode, x.member.fullName, x.member.phone, x.reason, x.assignedTo?.user.name, x.status, x._count.events, x.lastContactAt?.toISOString().slice(0, 10), x.contactMethod, x.contactResult, x.returnedAt?.toISOString().slice(0, 10), x.returnedAt ? daysBetween(x.createdAt, x.returnedAt) : "", x.recoveredAt?.toISOString().slice(0, 10), x.closedAt?.toISOString().slice(0, 10), rs(x.monthlyFeePaisa), rs(x.protectedRevenuePaisa)]);
      break;
    }
    case "revenue":
    case "payments": {
      const p = await db.payment.findMany({ where: { createdAt: { gte: from, lt: toEnd }, ...(key === "revenue" ? { status: "SUCCEEDED" } : {}) }, include: { member: { select: { memberCode: true, fullName: true } }, invoice: true }, orderBy: { createdAt: "asc" }, take: LIMIT });
      headers = ["Date", "Reference", "Receipt", "Member ID", "Name", "Purpose", "Method", "Provider", "Status", "Amount (NPR)", "Discount (NPR)", "Failure reason"];
      rows = p.map((x) => [(x.paidAt ?? x.createdAt).toISOString().slice(0, 10), x.reference, x.invoice?.number, x.member?.memberCode, x.member?.fullName, x.purpose, x.method, x.provider, x.status, rs(x.amountPaisa), rs(x.discountPaisa), x.failureReason]);
      break;
    }
    case "marketplace": {
      const o = await db.marketplaceOrder.findMany({ where: { placedAt: { gte: from, lt: toEnd } }, include: { member: { select: { memberCode: true, fullName: true } }, items: true }, orderBy: { placedAt: "asc" }, take: LIMIT });
      headers = ["Placed", "Order", "Member ID", "Name", "Items", "Status", "Total (NPR)", "Gym share (NPR)", "Platform fee (NPR)", "Vendor share (NPR)"];
      rows = o.map((x) => [x.placedAt.toISOString().slice(0, 10), x.number, x.member.memberCode, x.member.fullName, x.items.map((i) => `${i.name} x${i.quantity}`).join("; "), x.status, rs(x.totalPaisa), rs(x.gymSharePaisa), rs(x.platformFeePaisa), rs(x.vendorSharePaisa)]);
      break;
    }
    case "imports": {
      const j = await db.importJob.findMany({ where: { startedAt: { gte: from, lt: toEnd } }, include: { file: true, predictionReport: { select: { id: true } } }, orderBy: { startedAt: "asc" }, take: LIMIT });
      headers = ["Uploaded", "File", "Type", "Status", "Rows", "Clean", "Needs review", "Duplicates", "Invalid", "Imported", "Skipped", "Quality score", "OCR", "Prediction generated"];
      rows = j.map((x) => [x.startedAt.toISOString().slice(0, 10), x.file.originalName, x.recordType, x.status, x.totalRows, x.cleanRows, x.reviewRows, x.duplicateRows, x.invalidRows, x.importedRows, x.skippedRows, x.qualityScore, x.ocrUsed ? "Yes" : "No", x.predictionReport ? "Yes" : "No"]);
      break;
    }
  }
  return { filename: `gympulse-${key}-${range.from}-to-${range.to}.csv`, csv: toCsv(headers, rows) };
}
