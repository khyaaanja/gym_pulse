import { describe, expect, it } from "vitest";
import { assessMember, confidenceOf, SHORT_HISTORY_MIN_DAYS, type MemberInput } from "@/services/risk/engine";
import { BUILTIN_CONFIG } from "@/config/prediction";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

const stats = { membersAnalyzed: 40, attendanceRecords: 480, qualityScore: 100, calibrated: false };

describe("confidence with short history (one monthly register)", () => {
  it("gives a Low-confidence estimate for about one month of history", () => {
    const c = confidenceOf({ ...stats, historyDays: 29 }, BUILTIN_CONFIG);
    expect(c.level).toBe("LOW");
    expect(c.insufficientReason).toBeNull();
    expect(c.reasons[0]).toMatch(/Only 29 days of attendance history/);
  });
  it("forces Low even when other signals would score higher", () => {
    expect(confidenceOf({ ...stats, historyDays: 58, membersAnalyzed: 150, attendanceRecords: 5000 }, BUILTIN_CONFIG).level).toBe("LOW");
  });
  it("still refuses less than the short-history floor", () => {
    const c = confidenceOf({ ...stats, historyDays: SHORT_HISTORY_MIN_DAYS - 1 }, BUILTIN_CONFIG);
    expect(c.level).toBe("INSUFFICIENT");
    expect(c.insufficientReason).toMatch(/one full month/);
  });
  it("is unchanged once the configured minimum is met", () => {
    expect(confidenceOf({ ...stats, historyDays: 90 }, BUILTIN_CONFIG).level).toBe("MODERATE");
  });
  it("respects a gym whose minimum is below the floor", () => {
    expect(confidenceOf({ ...stats, historyDays: 20 }, { ...BUILTIN_CONFIG, minHistoryDays: 14 }).level).not.toBe("INSUFFICIENT");
  });
});

describe("renewal history of imported members", () => {
  const base: MemberInput = {
    memberId: "m1",
    today: "2026-08-31",
    joinedOn: "2026-08-01",
    visits: ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-10", "2026-08-12", "2026-08-15"],
    lastVisit: "2026-08-15",
    active: { startDate: "2026-08-01", endDate: "2026-10-15", monthlyFeePaisa: 250_000 },
    lastEndedOn: null,
    renewals: 0,
  };
  it("adds no risk and no reason when renewal history is unknown", () => {
    const known = assessMember(base, BUILTIN_CONFIG);
    const unknown = assessMember({ ...base, renewalKnown: false }, BUILTIN_CONFIG);
    expect(known.factors.some((f) => f.key === "renewal")).toBe(true);
    expect(unknown.factors.some((f) => f.key === "renewal")).toBe(false);
    expect(unknown.score).toBeLessThan(known.score);
  });
  it("still flags a member who stopped coming, using their rhythm within the month", () => {
    const a = assessMember({ ...base, renewalKnown: false }, BUILTIN_CONFIG);
    expect(a.signals.daysSinceLastVisit).toBe(16);
    expect(a.signals.baselineGapDays).toBeCloseTo(2.8, 1);
    expect(a.riskStatus).toBe("AT_RISK");
    expect(a.factors.map((f) => f.detail)).toContain("Away 16 days; usually comes every 2.8 days");
    expect(["HIGH", "CRITICAL", "MODERATE"]).toContain(a.category);
  });
  it("does not flag a regular from one month of data", () => {
    const visits = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`).filter((_, i) => i % 7 !== 0);
    const a = assessMember({ ...base, visits, lastVisit: "2026-08-31", renewalKnown: false }, BUILTIN_CONFIG);
    expect(a.category).toBe("LOW");
    expect(a.riskStatus).toBe("ACTIVE");
  });
});

describe("currency formatting", () => {
  it("writes Nepali rupees with a space by default", () => {
    expect(formatMoney(250_000)).toBe("Rs. 2,500");
    expect(formatMoney(-250_000, "NPR")).toBe("-NPR 2,500");
    expect(formatMoney(250_000, "रु")).toBe("रु 2,500");
    expect(formatMoneyCompact(15_000_000)).toBe("Rs. 1.5L");
  });
  it("keeps a single currency sign attached", () => {
    expect(formatMoney(250_000, "₹")).toBe("₹2,500");
  });
});
