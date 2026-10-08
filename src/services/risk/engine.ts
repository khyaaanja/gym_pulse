/**
 * Risk Engine v1 — transparent, rules-based churn-risk estimation.
 *
 * This is deliberately NOT machine learning. Each member gets a 0–100 score built from a
 * handful of observable gym signals (attendance, gaps, expiry, renewal history). Every point
 * of the score is attributable to a named factor that is shown to staff. Scores are mapped to
 * an *estimated* likelihood; until enough real outcomes exist to calibrate that mapping, it is
 * a heuristic curve and reports are labelled uncalibrated.
 *
 * Only gym activity and membership data are used. No demographic or personal attributes.
 */
import { addDays, diffDays, type DateOnly } from "@/lib/time";
import { clamp } from "@/lib/utils";
import type { ResolvedPredictionConfig, RiskWeights } from "@/config/prediction";
import type { ConfidenceLevel, RiskCategory, RiskStatus } from "@/generated/prisma/enums";

export type MemberInput = {
  memberId: string;
  today: DateOnly;
  joinedOn: DateOnly;
  /** Visit days inside the analysis window, ascending, unique. */
  visits: DateOnly[];
  /** Most recent visit ever (may predate the window). */
  lastVisit: DateOnly | null;
  /** Current active membership, if any. */
  active: { startDate: DateOnly; endDate: DateOnly; monthlyFeePaisa: number } | null;
  /** End date of the most recent membership when none is active. */
  lastEndedOn: DateOnly | null;
  renewals: number;
  /**
   * False when we can't know whether the member has renewed: an imported member whose
   * "join date" is just their first visit in the uploaded records. Defaults to true.
   */
  renewalKnown?: boolean;
};

export type Signals = {
  daysSinceLastVisit: number;
  neverVisited: boolean;
  visitsLast30: number;
  visitsPrev30: number;
  declinePct: number | null;
  baselineGapDays: number | null;
  visitsPerWeek: number;
  prevVisitsPerWeek: number;
  recentVisitsPerWeek: number;
  daysToExpiry: number | null;
  daysSinceExpiry: number | null;
  membershipAgeDays: number;
  observedDays: number;
};

export type Factor = { key: string; label: string; detail: string; contribution: number };

export type Assessment = {
  memberId: string;
  signals: Signals;
  score: number;
  likelihood: number;
  category: RiskCategory;
  riskStatus: RiskStatus;
  factors: Factor[];
  recommendedAction: string;
  monthlyFeePaisa: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function computeSignals(m: MemberInput, cfg: Pick<ResolvedPredictionConfig, "analysisWindowDays">): Signals {
  const { today } = m;
  const windowStart = addDays(today, -cfg.analysisWindowDays);
  const firstObservable = [m.joinedOn, windowStart].sort().at(-1)!;
  const observedDays = Math.max(1, diffDays(firstObservable, today));

  const last30Start = addDays(today, -30);
  const prev30Start = addDays(today, -60);
  const visitsLast30 = m.visits.filter((d) => d > last30Start && d <= today).length;
  const visitsPrev30 = m.visits.filter((d) => d > prev30Start && d <= last30Start).length;

  const reference = m.lastVisit ?? ([m.joinedOn, m.active?.startDate].filter(Boolean).sort().at(-1) as DateOnly);
  const daysSinceLastVisit = Math.max(0, diffDays(reference, today));

  // Average gap between visits before the most recent 30 days — the member's "normal rhythm".
  const baseline = m.visits.filter((d) => d <= last30Start);
  let baselineGapDays: number | null = null;
  // Without a month of older visits (a new member, or a single uploaded register), read the rhythm
  // from every visit so far — the gaps between them all precede the current gap since the last visit.
  const rhythm = baseline.length >= 3 ? baseline : m.visits;
  if (rhythm.length >= 3) {
    const gaps = rhythm.slice(1).map((d, i) => diffDays(rhythm[i]!, d));
    baselineGapDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  const baselineDays = Math.max(1, Math.min(observedDays, cfg.analysisWindowDays) - 30);
  const prevVisitsPerWeek = baseline.length ? (baseline.length / baselineDays) * 7 : visitsPrev30 / (30 / 7);

  return {
    daysSinceLastVisit,
    neverVisited: m.lastVisit === null,
    visitsLast30,
    visitsPrev30,
    declinePct: visitsPrev30 >= 2 ? Math.max(0, (visitsPrev30 - visitsLast30) / visitsPrev30) : null,
    baselineGapDays,
    visitsPerWeek: (m.visits.length / observedDays) * 7,
    prevVisitsPerWeek,
    recentVisitsPerWeek: visitsLast30 / (30 / 7),
    daysToExpiry: m.active ? diffDays(today, m.active.endDate) : null,
    daysSinceExpiry: !m.active && m.lastEndedOn ? diffDays(m.lastEndedOn, today) : null,
    membershipAgeDays: Math.max(0, diffDays(m.joinedOn, today)),
    observedDays,
  };
}

/** Operational status shown on the Pulse screen. This part is factual, not a prediction. */
export function riskStatusOf(
  s: Signals,
  hasActive: boolean,
  hadMembership: boolean,
  cfg: Pick<ResolvedPredictionConfig, "inactivityThresholdDays" | "attentionAfterDays" | "lostAfterExpiryDays">,
): RiskStatus {
  if (!hasActive && hadMembership) {
    return (s.daysSinceExpiry ?? 0) > cfg.lostAfterExpiryDays ? "LOST" : "ATTENTION";
  }
  // "At Risk" means revenue is at stake: an active membership plus inactivity. Without any
  // membership on record we can only say the member needs attention.
  if (s.daysSinceLastVisit >= cfg.inactivityThresholdDays) return hasActive ? "AT_RISK" : "ATTENTION";
  const sharpDrop = s.declinePct !== null && s.declinePct >= 0.4 && s.visitsPrev30 >= 4;
  if (s.daysSinceLastVisit >= cfg.attentionAfterDays || sharpDrop) return "ATTENTION";
  return "ACTIVE";
}

function expiryComponent(s: Signals): number {
  if (s.daysSinceExpiry !== null) return 1;
  const d = s.daysToExpiry;
  if (d === null) return 0;
  if (d <= 0) return 1;
  if (d <= 3) return 0.9;
  if (d <= 7) return 0.75;
  if (d <= 14) return 0.5;
  if (d <= 30) return 0.2;
  return 0;
}

function normalisedWeights(w: RiskWeights): RiskWeights {
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, (v / total) * 100])) as RiskWeights;
}

/** Heuristic score→likelihood curve used until calibrated outcome data exists. */
export function heuristicLikelihood(score: number): number {
  return 1 / (1 + Math.exp(-(score - 55) / 10));
}

export type Calibration = { buckets: { min: number; max: number; rate: number; n: number }[] } | null;

export function likelihoodFor(score: number, calibration: Calibration): number {
  if (!calibration) return heuristicLikelihood(score);
  const b = calibration.buckets.find((x) => score >= x.min && score <= x.max);
  return b ? b.rate : heuristicLikelihood(score);
}

export function assessMember(
  m: MemberInput,
  cfg: ResolvedPredictionConfig,
  calibration: Calibration = null,
): Assessment {
  const s = computeSignals(m, cfg);
  const w = normalisedWeights(cfg.weights);
  const threshold = cfg.inactivityThresholdDays;

  const inactivity = clamp(s.daysSinceLastVisit / (2 * threshold), 0, 1);
  const decline = s.declinePct ?? 0;
  const disengagement = Math.max(inactivity, decline);
  // Expiry matters far more for a member who has also stopped showing up.
  const expiry = expiryComponent(s) * (0.5 + 0.5 * disengagement);
  const gap = s.baselineGapDays ? clamp((s.daysSinceLastVisit / Math.max(1, s.baselineGapDays) - 1) / 3, 0, 1) : 0;
  const frequency = s.visitsPerWeek < 0.5 ? 1 : s.visitsPerWeek < 1 ? 0.6 : s.visitsPerWeek < 2 ? 0.3 : 0;
  // Unknown renewal history adds no risk: a long-standing member first seen in an upload isn't "new".
  const renewalKnown = m.renewals > 0 || m.renewalKnown !== false;
  const renewal = !renewalKnown || m.renewals > 0 ? 0 : s.membershipAgeDays < 120 ? 0.6 : 0.3;

  const parts: Factor[] = [];
  const add = (key: string, label: string, component: number, weight: number, detail: string) => {
    const contribution = component * weight;
    if (contribution >= 0.5) parts.push({ key, label, detail, contribution: r1(contribution) });
  };

  add(
    "inactivity",
    "Days since last visit",
    inactivity,
    w.inactivity,
    s.neverVisited ? `No recorded visit in ${days(s.daysSinceLastVisit)} since joining` : `${days(s.daysSinceLastVisit)} since last visit`,
  );
  if (s.declinePct !== null) {
    add(
      "decline",
      "Attendance trend",
      decline,
      w.decline,
      `Attendance dropped ${Math.round(decline * 100)}% in the last 30 days (${s.visitsPrev30} → ${s.visitsLast30} visits)`,
    );
  }
  if (s.daysSinceExpiry !== null) {
    add("expiry", "Membership expiry", expiry, w.expiry, `Membership expired ${days(s.daysSinceExpiry)} ago and hasn't been renewed`);
  } else if (s.daysToExpiry !== null) {
    add(
      "expiry",
      "Membership expiry",
      expiry,
      w.expiry,
      s.daysToExpiry <= 0 ? "Membership expires today" : `Membership expires in ${days(s.daysToExpiry)}`,
    );
  }
  if (s.baselineGapDays) {
    add(
      "gap",
      "Visit gap",
      gap,
      w.gap,
      `Away ${days(s.daysSinceLastVisit)}; usually comes ${r1(s.baselineGapDays) <= 1 ? "every day" : `every ${r1(s.baselineGapDays)} days`}`,
    );
  }
  // "Before" only exists when the records reach back past the last 30 days; a single month's register has no "before".
  const frequencyDetail =
    s.observedDays > 30
      ? `Visits a week: ${r1(s.prevVisitsPerWeek)} before, ${r1(s.recentVisitsPerWeek)} in the last 30 days`
      : `About ${r1(s.visitsPerWeek)} visits a week`;
  add("frequency", "Visit frequency", frequency, w.frequency, frequencyDetail);
  // When attendance is falling, show the before/after rhythm even if it adds no points.
  if (!parts.some((p) => p.key === "frequency") && decline >= 0.25) {
    parts.push({ key: "frequency", label: "Visit frequency", detail: frequencyDetail, contribution: 0 });
  }
  if (renewalKnown) {
    add(
      "renewal",
      "Renewal history",
      renewal,
      w.renewalHistory,
      m.renewals > 0 ? `Renewed ${m.renewals === 1 ? "once" : `${m.renewals} times`} before` : `Hasn't renewed before (member for ${days(s.membershipAgeDays)})`,
    );
  }

  const score = Math.round(clamp(inactivity * w.inactivity + decline * w.decline + expiry * w.expiry + gap * w.gap + frequency * w.frequency + renewal * w.renewalHistory, 0, 100));

  let category: RiskCategory =
    score >= cfg.criticalThreshold ? "CRITICAL" : score >= cfg.highThreshold ? "HIGH" : score >= cfg.moderateThreshold ? "MODERATE" : "LOW";
  // Severe inactivity with an imminent (or just-passed) expiry always needs attention today.
  const imminent = (s.daysToExpiry !== null && s.daysToExpiry <= 7) || (s.daysSinceExpiry !== null && s.daysSinceExpiry <= cfg.lostAfterExpiryDays);
  if (s.daysSinceLastVisit >= 2 * threshold && imminent) category = "CRITICAL";

  const riskStatus = riskStatusOf(s, !!m.active, !!m.active || !!m.lastEndedOn, cfg);
  parts.sort((a, b) => b.contribution - a.contribution);
  if (parts.length === 0) {
    parts.push({ key: "healthy", label: "Normal attendance pattern", detail: `Visiting about ${r1(s.visitsPerWeek)} times/week`, contribution: 0 });
  }

  return {
    memberId: m.memberId,
    signals: s,
    score,
    likelihood: likelihoodFor(score, calibration),
    category,
    riskStatus,
    factors: parts,
    recommendedAction: recommendedAction(category, riskStatus),
    monthlyFeePaisa: m.active?.monthlyFeePaisa ?? 0,
  };
}

export function recommendedAction(category: RiskCategory, status: RiskStatus): string {
  if (status === "LOST") return "Send a win-back offer";
  switch (category) {
    case "CRITICAL":
      return "Contact member today";
    case "HIGH":
      return "Contact member within 2 days";
    case "MODERATE":
      return "Send a friendly check-in message";
    default:
      return "No action needed";
  }
}

// ─────────────────────────────── Aggregate estimate ───────────────────────────────

export type DataStats = {
  membersAnalyzed: number;
  attendanceRecords: number;
  historyDays: number;
  qualityScore: number | null;
  calibrated: boolean;
};

/**
 * Below the configured history minimum, about one month of records (e.g. a single monthly
 * register) still gives an estimate — always at Low confidence with wide ranges — because
 * inactivity, visit frequency and expiry are readable from one month; only trends are not.
 */
export const SHORT_HISTORY_MIN_DAYS = 25;

export function confidenceOf(
  d: DataStats,
  cfg: Pick<ResolvedPredictionConfig, "minMembers" | "minAttendanceRecords" | "minHistoryDays">,
): { level: ConfidenceLevel; reasons: string[]; insufficientReason: string | null } {
  const reasons: string[] = [];
  if (d.membersAnalyzed < cfg.minMembers) {
    return {
      level: "INSUFFICIENT",
      reasons,
      insufficientReason: `Only ${d.membersAnalyzed} members with membership data — at least ${cfg.minMembers} are needed for a reliable estimate.`,
    };
  }
  if (d.attendanceRecords < cfg.minAttendanceRecords) {
    return {
      level: "INSUFFICIENT",
      reasons,
      insufficientReason: `Only ${d.attendanceRecords} attendance records — upload at least ${cfg.minAttendanceRecords} valid attendance records to generate an estimate.`,
    };
  }
  const shortHistory = d.historyDays < cfg.minHistoryDays;
  if (shortHistory && d.historyDays < Math.min(SHORT_HISTORY_MIN_DAYS, cfg.minHistoryDays)) {
    return {
      level: "INSUFFICIENT",
      reasons,
      insufficientReason: `Attendance history covers ${d.historyDays} days — upload at least one full month of attendance to generate an estimate.`,
    };
  }
  let points = 0;
  const score = (delta: number, reason?: string) => {
    points += delta;
    if (reason) reasons.push(reason);
  };
  if (d.historyDays >= 180) score(2, "6+ months of attendance history");
  else if (d.historyDays >= 90) score(1, `${Math.round(d.historyDays / 30)} months of attendance history`);
  else score(0, "Short attendance history");
  const perMember = d.attendanceRecords / Math.max(1, d.membersAnalyzed);
  if (perMember >= 20) score(2, "Detailed visit records per member");
  else if (perMember >= 8) score(1, "Moderate visit records per member");
  else score(0, "Few visit records per member");
  if (d.membersAnalyzed >= 100) score(1);
  if (d.qualityScore !== null) {
    if (d.qualityScore >= 90) score(1, "Clean imported data");
    else if (d.qualityScore < 70) score(-1, "Imported data had quality issues");
  }
  if (d.calibrated) score(1, "Calibrated against past outcomes");
  else score(0, "Not yet calibrated against real outcomes");

  let level: ConfidenceLevel = points >= 6 ? "HIGH" : points >= 3 ? "MODERATE" : "LOW";
  if (level === "HIGH" && !d.calibrated) level = "MODERATE";
  if (shortHistory) {
    level = "LOW";
    reasons.unshift(`Only ${d.historyDays} days of attendance history — attendance trends need ${cfg.minHistoryDays}+ days, so ranges are wide`);
  }
  return { level, reasons, insufficientReason: null };
}

export type Forecast = {
  estimatedAtRisk: number;
  rangeLow: number;
  rangeHigh: number;
  estimatedLoss: number;
  lossLow: number;
  lossHigh: number;
};

function interval(ps: number[], confidence: ConfidenceLevel, calibrated: boolean) {
  const mean = ps.reduce((a, b) => a + b, 0);
  const sd = Math.sqrt(ps.reduce((a, p) => a + p * (1 - p), 0));
  // 90% interval for a sum of independent Bernoullis, widened for data and model uncertainty.
  const widen = confidence === "LOW" ? 1.6 : confidence === "MODERATE" ? 1.25 : 1;
  const modelSlack = calibrated ? 0.05 * mean : 0.15 * mean;
  const half = 1.645 * sd * widen + modelSlack;
  return {
    mean: r1(mean),
    low: Math.max(0, Math.floor(mean - half)),
    high: Math.min(ps.length, Math.ceil(mean + half)),
  };
}

/**
 * Members-at-risk = expected count of members who disengage, over all non-lost members.
 * Loss in horizon = same, but members whose membership doesn't end within horizon+grace
 * count at `nonExpiringChurnShare` of their likelihood (they can stop coming, but rarely
 * cancel mid-term). Both are ranges, never point promises.
 */
export function forecast(
  assessments: Assessment[],
  cfg: Pick<ResolvedPredictionConfig, "forecastHorizonDays" | "nonExpiringChurnShare">,
  graceDays: number,
  confidence: ConfidenceLevel,
  calibrated: boolean,
): Forecast {
  const live = assessments.filter((a) => a.riskStatus !== "LOST");
  const atRisk = interval(live.map((a) => a.likelihood), confidence, calibrated);
  const horizon = cfg.forecastHorizonDays + graceDays;
  const lossPs = live.map((a) => {
    const d = a.signals.daysToExpiry;
    const ending = a.signals.daysSinceExpiry !== null || (d !== null && d <= horizon);
    return a.likelihood * (ending ? 1 : cfg.nonExpiringChurnShare);
  });
  const loss = interval(lossPs, confidence, calibrated);
  return {
    estimatedAtRisk: atRisk.mean,
    rangeLow: atRisk.low,
    rangeHigh: atRisk.high,
    estimatedLoss: loss.mean,
    lossLow: loss.low,
    lossHigh: loss.high,
  };
}

/** Wilson score interval for a proportion. Used for recovery-rate scenarios. */
export function wilson(successes: number, n: number, z = 1.645): { low: number; high: number; rate: number } {
  if (n === 0) return { low: 0, high: 0, rate: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom), rate: p };
}
