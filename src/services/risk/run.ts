import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { MODEL_VERSION, predictionConfigFor, type ResolvedPredictionConfig } from "@/config/prediction";
import { gymSettings } from "@/config/gym-settings";
import { addDays, diffDays, fromDbDate, toDbDate, today as todayIn, type DateOnly } from "@/lib/time";
import { monthlyEquivalent } from "@/lib/money";
import { chunk } from "@/lib/utils";
import type { PredictionSource, RiskCategory, RiskStatus } from "@/generated/prisma/enums";
import {
  assessMember,
  confidenceOf,
  forecast,
  wilson,
  type Assessment,
  type Calibration,
  type MemberInput,
} from "./engine";

export type Transition = { memberId: string; from: RiskStatus; to: RiskStatus; score: number; category: RiskCategory };

type Loaded = {
  inputs: MemberInput[];
  attendanceRecords: number;
  earliestVisit: DateOnly | null;
  today: DateOnly;
  tz: string;
  graceDays: number;
  previous: Map<string, { status: RiskStatus; category: RiskCategory | null; lastAttendanceAt: Date | null }>;
  /** True when `today` is the end of imported records rather than the real date (see riskAsOf). */
  anchored: boolean;
};

/**
 * The day risk is measured "as of". Normally today. A gym that has never recorded a live
 * check-in only has uploaded registers, and we know nothing about visits after they end —
 * measuring from today would call every regular "inactive". Such gyms are measured as of
 * the last day in their records, until the first real check-in switches them to today.
 */
export async function riskAsOf(gymId: string, today: DateOnly): Promise<{ asOf: DateOnly; anchored: boolean }> {
  const db = tenantDb(gymId);
  const live = await db.attendance.findFirst({ where: { method: { not: "IMPORT" } }, select: { id: true } });
  if (live) return { asOf: today, anchored: false };
  const latest = await db.attendance.aggregate({ _max: { localDate: true }, where: { localDate: { lte: toDbDate(today) } } });
  const end = latest._max.localDate ? fromDbDate(latest._max.localDate) : null;
  return end && end < today ? { asOf: end, anchored: true } : { asOf: today, anchored: false };
}

export async function loadMemberInputs(gymId: string, cfg: ResolvedPredictionConfig, asOf?: DateOnly): Promise<Loaded> {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const db = tenantDb(gymId);
  const anchor = asOf ? { asOf, anchored: false } : await riskAsOf(gymId, todayIn(gym.timezone));
  const today = anchor.asOf;
  const windowStart = addDays(today, -cfg.analysisWindowDays);

  const [members, memberships, attendance, lastVisits, earliest] = await Promise.all([
    db.member.findMany({
      where: { archivedAt: null, status: { in: ["ACTIVE", "FROZEN"] } },
      select: { id: true, joinedOn: true, source: true, riskStatus: true, riskCategory: true, lastAttendanceAt: true },
    }),
    db.membership.findMany({
      where: { status: { in: ["ACTIVE", "EXPIRED", "FROZEN"] } },
      select: { memberId: true, startDate: true, endDate: true, pricePaisa: true, isRenewal: true, status: true, plan: { select: { durationDays: true } } },
    }),
    db.attendance.findMany({
      where: { localDate: { gt: toDbDate(windowStart), lte: toDbDate(today) } },
      select: { memberId: true, localDate: true },
      orderBy: { localDate: "asc" },
    }),
    db.attendance.groupBy({ by: ["memberId"], _max: { localDate: true }, _min: { localDate: true }, where: { localDate: { lte: toDbDate(today) } } }),
    db.attendance.aggregate({ _min: { localDate: true } }),
  ]);

  const visitsBy = new Map<string, DateOnly[]>();
  for (const a of attendance) {
    const list = visitsBy.get(a.memberId) ?? [];
    list.push(fromDbDate(a.localDate));
    visitsBy.set(a.memberId, list);
  }
  const lastBy = new Map(lastVisits.map((l) => [l.memberId, l._max.localDate ? fromDbDate(l._max.localDate) : null]));
  const firstBy = new Map(lastVisits.map((l) => [l.memberId, l._min.localDate ? fromDbDate(l._min.localDate) : null]));
  const msBy = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const list = msBy.get(m.memberId) ?? [];
    list.push(m);
    msBy.set(m.memberId, list);
  }

  const inputs: MemberInput[] = members.map((m) => {
    const ms = msBy.get(m.id) ?? [];
    const active = ms
      .filter((x) => fromDbDate(x.startDate) <= today && fromDbDate(x.endDate) >= today && x.status !== "FROZEN")
      .sort((a, b) => +b.endDate - +a.endDate)[0];
    const ended = ms.filter((x) => fromDbDate(x.endDate) < today).sort((a, b) => +b.endDate - +a.endDate)[0];
    // An imported member with no join date gets their first recorded visit as "joined" — that's
    // where our records start, not when they joined, so renewal history is unknown.
    const firstVisit = firstBy.get(m.id);
    const joinedIsGuess = m.source === "IMPORT" && !!firstVisit && fromDbDate(m.joinedOn) >= firstVisit;
    return {
      memberId: m.id,
      today,
      joinedOn: fromDbDate(m.joinedOn),
      visits: visitsBy.get(m.id) ?? [],
      lastVisit: lastBy.get(m.id) ?? null,
      active: active
        ? {
            startDate: fromDbDate(active.startDate),
            endDate: fromDbDate(active.endDate),
            monthlyFeePaisa: monthlyEquivalent(active.pricePaisa, active.plan.durationDays),
          }
        : null,
      lastEndedOn: active ? null : ended ? fromDbDate(ended.endDate) : null,
      renewals: ms.filter((x) => x.isRenewal).length,
      renewalKnown: !joinedIsGuess,
    };
  });

  return {
    inputs,
    attendanceRecords: attendance.length,
    earliestVisit: earliest._min.localDate ? fromDbDate(earliest._min.localDate) : null,
    today,
    tz: gym.timezone,
    graceDays: gymSettings(gym.settings).renewal.gracePeriodDays,
    previous: new Map(members.map((m) => [m.id, { status: m.riskStatus, category: m.riskCategory, lastAttendanceAt: m.lastAttendanceAt }])),
    anchored: anchor.anchored,
  };
}

/** Empirical score→churn-rate table from evaluated past assessments (pooled platform-wide, aggregate only). */
export async function loadCalibration(minOutcomes = 200): Promise<Calibration> {
  const rows = await prisma.$queryRaw<{ bucket: number; n: bigint; churned: bigint }[]>`
    SELECT LEAST(9, FLOOR("score" / 10))::int AS bucket, COUNT(*) AS n, COUNT(*) FILTER (WHERE "outcome" = 'CHURNED') AS churned
    FROM "RiskAssessment"
    WHERE "modelVersion" = ${MODEL_VERSION} AND "outcome" IN ('RETAINED', 'CHURNED')
    GROUP BY 1 ORDER BY 1`;
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  if (total < minOutcomes) return null;
  const overall = rows.reduce((a, r) => a + Number(r.churned), 0) / total;
  const prior = 10; // Beta smoothing toward the overall rate for thin buckets
  return {
    buckets: rows.map((r) => ({
      min: r.bucket * 10,
      max: r.bucket === 9 ? 100 : r.bucket * 10 + 9,
      n: Number(r.n),
      rate: (Number(r.churned) + prior * overall) / (Number(r.n) + prior),
    })),
  };
}

/**
 * Daily refresh: recompute every member's operational risk status and score, record
 * transitions in RiskHistory, and return transitions so automations can react.
 */
export async function recalculateGymRisk(gymId: string, asOf?: DateOnly): Promise<{ assessed: number; transitions: Transition[]; assessments: Assessment[]; loaded: Loaded; cfg: ResolvedPredictionConfig; calibration: Calibration }> {
  const cfg = await predictionConfigFor(gymId);
  const loaded = await loadMemberInputs(gymId, cfg, asOf);
  const calibration = await loadCalibration();
  const assessments = loaded.inputs.map((i) => assessMember(i, cfg, calibration));
  const db = tenantDb(gymId);
  const transitions: Transition[] = [];
  const now = new Date();
  const inputBy = new Map(loaded.inputs.map((i) => [i.memberId, i]));

  for (const batch of chunk(assessments, 100)) {
    await db.$transaction(
      batch.flatMap((a) => {
        const prev = loaded.previous.get(a.memberId)!;
        const lastVisit = inputBy.get(a.memberId)?.lastVisit;
        const ops = [
          db.member.update({
            where: { id: a.memberId },
            data: {
              riskStatus: a.riskStatus,
              riskCategory: a.category,
              riskScore: a.score,
              riskUpdatedAt: now,
              ...(lastVisit && !prev.lastAttendanceAt ? { lastAttendanceAt: toDbDate(lastVisit) } : {}),
            },
          }),
        ];
        if (prev.status !== a.riskStatus || prev.category !== a.category) {
          if (prev.status !== a.riskStatus) {
            transitions.push({ memberId: a.memberId, from: prev.status, to: a.riskStatus, score: a.score, category: a.category });
          }
          ops.push(
            db.riskHistory.create({
              data: {
                gymId,
                memberId: a.memberId,
                fromStatus: prev.status,
                toStatus: a.riskStatus,
                fromCategory: prev.category,
                toCategory: a.category,
                score: a.score,
                reason: a.factors[0]?.detail ?? "Recalculated",
              },
            }) as never,
          );
        }
        return ops;
      }),
    );
  }
  return { assessed: assessments.length, transitions, assessments, loaded, cfg, calibration };
}

/** Historical recovery rate for the scenario panel: recovered ÷ contacted, among closed at-risk tasks. */
export async function recoveryHistory(gymId: string) {
  const db = tenantDb(gymId);
  const contacted = await db.recoveryTask.count({ where: { lastContactAt: { not: null }, status: { in: ["RETURNED", "RENEWED", "LOST"] } } });
  const recovered = await db.recoveryTask.count({ where: { lastContactAt: { not: null }, status: { in: ["RETURNED", "RENEWED"] } } });
  return { contacted, recovered };
}

export const MIN_RECOVERY_HISTORY = 10;

/**
 * Builds a PredictionReport: individual assessments with explanations, an estimate range,
 * confidence, drivers, a revenue projection and a contact scenario. When data is too thin the
 * report is stored with confidence INSUFFICIENT and no numbers — never a fabricated estimate.
 */
export async function generatePredictionReport(
  gymId: string,
  opts: { source: PredictionSource; importJobId?: string; createdById?: string; qualityScore?: number | null; asOf?: DateOnly },
) {
  const { assessments, loaded, cfg, calibration } = await recalculateGymRisk(gymId, opts.asOf);
  const db = tenantDb(gymId);

  const withMembership = assessments.filter((a) => a.monthlyFeePaisa > 0 || a.signals.daysSinceExpiry !== null);
  const historyDays = loaded.earliestVisit ? Math.min(cfg.analysisWindowDays, diffDays(loaded.earliestVisit, loaded.today)) : 0;
  const conf = confidenceOf(
    {
      membersAnalyzed: withMembership.length,
      attendanceRecords: loaded.attendanceRecords,
      historyDays,
      qualityScore: opts.qualityScore ?? null,
      calibrated: !!calibration,
    },
    cfg,
  );

  const live = assessments.filter((a) => a.riskStatus !== "LOST");
  const activeMembers = assessments.filter((a) => a.monthlyFeePaisa > 0).length;
  const highRisk = live.filter((a) => a.category === "HIGH" || a.category === "CRITICAL");
  const declining = live.filter((a) => (a.signals.declinePct ?? 0) >= 0.4 && a.signals.visitsPrev30 >= 4);
  const expiring = live.filter((a) => a.signals.daysToExpiry !== null && a.signals.daysToExpiry <= cfg.forecastHorizonDays);
  const longGap = live.filter((a) => a.signals.daysSinceLastVisit >= cfg.inactivityThresholdDays);
  const neverRenewed = live.filter((a) => a.factors.some((f) => f.key === "renewal") && (a.category === "HIGH" || a.category === "CRITICAL"));

  const fc = conf.level === "INSUFFICIENT" ? null : forecast(assessments, cfg, loaded.graceDays, conf.level, !!calibration);

  const fees = assessments.map((a) => a.monthlyFeePaisa).filter((f) => f > 0);
  const avgFee = fees.length ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : 0;

  const rec = await recoveryHistory(gymId);
  let scenarios: Record<string, unknown>;
  if (!fc) {
    scenarios = { available: false };
  } else if (rec.contacted < MIN_RECOVERY_HISTORY) {
    scenarios = {
      available: true,
      currentPattern: { low: fc.lossLow, high: fc.lossHigh },
      ifContacted: null,
      ifContactedNote: `Not enough recovery history yet — we'll estimate this once at least ${MIN_RECOVERY_HISTORY} contacted members have an outcome (you have ${rec.contacted}).`,
    };
  } else {
    const w = wilson(rec.recovered, rec.contacted);
    scenarios = {
      available: true,
      currentPattern: { low: fc.lossLow, high: fc.lossHigh },
      // Only members who would otherwise be lost can be "retained", so the scenario scales the loss range.
      ifContacted: { low: Math.floor(fc.lossLow * w.low), high: Math.min(fc.lossHigh, Math.ceil(fc.lossHigh * w.high)) },
      recoveryRate: { rate: w.rate, low: w.low, high: w.high, contacted: rec.contacted, recovered: rec.recovered },
      ifContactedNote: `Of the members estimated to leave, based on your gym's past recovery rate of ${Math.round(w.rate * 100)}% (${rec.recovered} of ${rec.contacted} contacted members returned). This is an estimate, not a promise.`,
    };
  }

  const report = await db.predictionReport.create({
    data: {
      gymId,
      source: opts.source,
      importJobId: opts.importJobId,
      createdById: opts.createdById,
      modelVersion: MODEL_VERSION,
      periodStart: loaded.earliestVisit ? toDbDate([loaded.earliestVisit, addDays(loaded.today, -cfg.analysisWindowDays)].sort().at(-1)!) : null,
      periodEnd: toDbDate(loaded.today),
      horizonDays: cfg.forecastHorizonDays,
      membersAnalyzed: withMembership.length,
      attendanceRecords: loaded.attendanceRecords,
      confidence: conf.level,
      insufficientReason: conf.insufficientReason,
      estimatedAtRisk: fc?.estimatedAtRisk,
      rangeLow: fc?.rangeLow,
      rangeHigh: fc?.rangeHigh,
      estimatedLoss: fc?.estimatedLoss,
      lossRangeLow: fc?.lossLow,
      lossRangeHigh: fc?.lossHigh,
      highRiskCount: highRisk.length,
      expiringCount: expiring.length,
      decliningCount: declining.length,
      longGapCount: longGap.length,
      activeMembers,
      calibrated: !!calibration,
      dataQuality: { historyDays, qualityScore: opts.qualityScore ?? null, confidenceReasons: conf.reasons, recordsEndAsOf: loaded.anchored ? loaded.today : null },
      scenarios: scenarios as never,
      configSnapshot: cfg as never,
    },
  });

  await db.predictionFactor.createMany({
    data: [
      { key: "decline", label: "Significant attendance decline", memberCount: declining.length, description: `${declining.length} members have significant attendance decline (40%+ fewer visits than the previous 30 days)` },
      { key: "expiry", label: "Approaching expiry", memberCount: expiring.length, description: `${expiring.length} members are approaching expiry within ${cfg.forecastHorizonDays} days` },
      { key: "gap", label: "Long attendance gaps", memberCount: longGap.length, description: `${longGap.length} members have gone ${cfg.inactivityThresholdDays}+ days without a visit` },
      { key: "new", label: "New, not yet renewed", memberCount: neverRenewed.length, description: `${neverRenewed.length} high-risk members have never renewed before` },
    ]
      .filter((f) => f.memberCount > 0)
      .sort((a, b) => b.memberCount - a.memberCount)
      .map((f, i) => ({ ...f, gymId, reportId: report.id, sortOrder: i })),
  });

  for (const batch of chunk(assessments, 200)) {
    await db.riskAssessment.createMany({
      data: batch.map((a) => ({
        gymId,
        memberId: a.memberId,
        reportId: report.id,
        modelVersion: MODEL_VERSION,
        score: a.score,
        likelihood: a.likelihood,
        category: a.category,
        riskStatus: a.riskStatus,
        factors: a.factors as never,
        recommendedAction: a.recommendedAction,
        daysSinceLastVisit: a.signals.daysSinceLastVisit,
        visitsLast30: a.signals.visitsLast30,
        visitsPrev30: a.signals.visitsPrev30,
        daysToExpiry: a.signals.daysToExpiry,
        monthlyFeePaisa: a.monthlyFeePaisa,
        dataPeriodStart: report.periodStart,
        dataPeriodEnd: report.periodEnd,
        horizonDays: cfg.forecastHorizonDays,
        // Members already lost aren't a forecast; don't score them as future outcomes.
        // Nor can a report measured as of old imported records be scored against later visits we'll never see.
        outcome: a.riskStatus === "LOST" || loaded.anchored ? "UNKNOWN" : "PENDING",
      })),
    });
  }

  if (fc) {
    await db.revenueProjection.create({
      data: {
        gymId,
        reportId: report.id,
        averageFeePaisa: avgFee,
        monthlyExposurePaisa: Math.round(fc.estimatedAtRisk * avgFee),
        rangeLowPaisa: fc.rangeLow * avgFee,
        rangeHighPaisa: fc.rangeHigh * avgFee,
        assumptions: {
          method: "Estimated members at risk × average monthly membership fee",
          averageFeeBasis: `${fees.length} members with an active membership`,
          period: "per month",
          note: "An estimate of revenue exposure, not a forecast of revenue that will definitely be lost.",
        },
      },
    });
  }

  return report;
}

/**
 * Outcome tracking for model quality. For assessments whose horizon has passed, record
 * whether the member was retained (active membership or a visit during the horizon) or churned.
 */
export async function evaluateOutcomes(limit = 5000) {
  const due = await prisma.$queryRaw<{ id: string; memberId: string; assessedAt: Date; horizonDays: number }[]>`
    SELECT "id", "memberId", "assessedAt", "horizonDays" FROM "RiskAssessment"
    WHERE "outcome" = 'PENDING' AND "assessedAt" + make_interval(days => "horizonDays") < now()
    ORDER BY "assessedAt" ASC LIMIT ${limit}`;
  let evaluated = 0;
  for (const a of due) {
    const end = new Date(a.assessedAt.getTime() + a.horizonDays * 86_400_000);
    const endDay = fromDbDate(end);
    const [visit, covering] = await Promise.all([
      prisma.attendance.count({ where: { memberId: a.memberId, checkedInAt: { gt: a.assessedAt, lte: end } } }),
      prisma.membership.count({
        where: { memberId: a.memberId, status: { in: ["ACTIVE", "EXPIRED"] }, startDate: { lte: toDbDate(endDay) }, endDate: { gte: toDbDate(endDay) } },
      }),
    ]);
    const churned = covering === 0 && visit === 0;
    await prisma.riskAssessment.update({ where: { id: a.id }, data: { outcome: churned ? "CHURNED" : "RETAINED", outcomeAt: new Date() } });
    evaluated++;
  }
  return { evaluated };
}

/** Precision / recall / calibration per model version for the Prediction Engine console. */
export async function modelQuality(modelVersion = MODEL_VERSION) {
  const rows = await prisma.riskAssessment.findMany({
    where: { modelVersion, outcome: { in: ["RETAINED", "CHURNED"] } },
    select: { category: true, likelihood: true, outcome: true },
  });
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const buckets = Array.from({ length: 10 }, (_, i) => ({ bucket: i, predicted: 0, observed: 0, n: 0 }));
  for (const r of rows) {
    const predicted = r.category === "HIGH" || r.category === "CRITICAL";
    const churned = r.outcome === "CHURNED";
    if (predicted && churned) tp++;
    else if (predicted && !churned) fp++;
    else if (!predicted && churned) fn++;
    else tn++;
    const b = buckets[Math.min(9, Math.floor(r.likelihood * 10))]!;
    b.n++;
    b.predicted += r.likelihood;
    b.observed += churned ? 1 : 0;
  }
  return {
    modelVersion,
    evaluated: rows.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    calibration: buckets.filter((b) => b.n > 0).map((b) => ({ bucket: b.bucket, n: b.n, meanPredicted: b.predicted / b.n, observedRate: b.observed / b.n })),
  };
}
