import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { json, params, req, signInStaff, signOut } from "./helpers/route";
import { day, TZ } from "./helpers/retention";
import { makeGym } from "./helpers/fixtures";
import { localInstant, toDbDate } from "@/lib/time";
import { confidenceOf } from "@/services/risk/engine";
import { BUILTIN_CONFIG } from "@/config/prediction";

const { HANDLERS } = await import("@/workers/handlers");
const { GET: list, POST: request } = await import("@/app/api/gym/predictions/route");
const { GET: detail } = await import("@/app/api/gym/predictions/[id]/route");

beforeEach(() => signOut());

/**
 * `healthy` members visit every other day for `historyDays`; `lapsed` members stopped `lapsedDays` ago.
 * All have an active membership of 150000 paisa / 30 days.
 */
async function seedGym(o: { healthy: number; lapsed: number; historyDays: number; lapsedDays?: number; endsIn?: number }) {
  const { gym, plan } = await makeGym();
  const attendance: { gymId: string; memberId: string; localDate: Date; checkedInAt: Date; method: "STAFF" }[] = [];
  const lapsedIds: string[] = [];
  const healthyIds: string[] = [];
  for (let i = 0; i < o.healthy + o.lapsed; i++) {
    const lapsed = i >= o.healthy;
    const m = await prisma.member.create({ data: { gymId: gym.id, memberCode: `P-${gym.slug}-${i}`, fullName: `Pred ${i}`, joinedOn: toDbDate(day(-o.historyDays)), phone: `97${String(i).padStart(8, "0")}` } });
    await prisma.membership.create({ data: { gymId: gym.id, memberId: m.id, planId: plan.id, startDate: toDbDate(day(-20)), endDate: toDbDate(day(o.endsIn ?? 5)), pricePaisa: 150_000, status: "ACTIVE", isRenewal: !lapsed } });
    (lapsed ? lapsedIds : healthyIds).push(m.id);
    const stop = lapsed ? (o.lapsedDays ?? 25) : 0;
    for (let d = o.historyDays; d >= stop; d -= 2) {
      attendance.push({ gymId: gym.id, memberId: m.id, localDate: toDbDate(day(-d)), checkedInAt: localInstant(day(-d), "09:00", TZ), method: "STAFF" });
    }
  }
  await prisma.attendance.createMany({ data: attendance });
  return { gym, plan, lapsedIds, healthyIds };
}

const generate = async (gymId: string) => {
  const out = (await HANDLERS["prediction.generate"]!({ gymId, source: "MANUAL" }, {} as never)) as { reportId: string; confidence: string };
  return { ...out, report: await prisma.predictionReport.findUniqueOrThrow({ where: { id: out.reportId } }) };
};

describe("confidence levels", () => {
  const cfg = BUILTIN_CONFIG;
  const base = { membersAnalyzed: 120, attendanceRecords: 4000, historyDays: 200, qualityScore: 95, calibrated: true };
  it("is INSUFFICIENT without enough members, records or history (never a made-up number)", () => {
    expect(confidenceOf({ ...base, membersAnalyzed: 5 }, cfg).level).toBe("INSUFFICIENT");
    expect(confidenceOf({ ...base, attendanceRecords: 10 }, cfg).level).toBe("INSUFFICIENT");
    const thin = confidenceOf({ ...base, historyDays: 10 }, cfg);
    expect(thin.level).toBe("INSUFFICIENT");
    expect(thin.insufficientReason).toMatch(/month/);
  });
  it("HIGH needs calibration; uncalibrated rich data tops out at MODERATE; short history is LOW", () => {
    expect(confidenceOf(base, cfg).level).toBe("HIGH");
    expect(confidenceOf({ ...base, calibrated: false }, cfg).level).toBe("MODERATE");
    const short = confidenceOf({ ...base, historyDays: 40 }, cfg);
    expect(short.level).toBe("LOW");
    expect(short.reasons.join(" ")).toMatch(/40 days/);
    expect(confidenceOf({ membersAnalyzed: 25, attendanceRecords: 100, historyDays: 90, qualityScore: 50, calibrated: false }, cfg).level).toBe("LOW");
  });
});

describe("prediction report via the job handler", () => {
  it("MODERATE report from 90 days of history: explainable per-member factors, ranges, revenue projection", async () => {
    const { gym, lapsedIds, healthyIds } = await seedGym({ healthy: 20, lapsed: 5, historyDays: 90, lapsedDays: 25 });
    const { report } = await generate(gym.id);
    expect(report.confidence).toBe("MODERATE");
    expect(report.membersAnalyzed).toBe(25);
    expect(report.attendanceRecords).toBeGreaterThan(30);
    expect(report.calibrated).toBe(false);
    expect(report.rangeLow! <= report.estimatedAtRisk! && report.estimatedAtRisk! <= report.rangeHigh!).toBe(true);
    expect(report.highRiskCount).toBeGreaterThanOrEqual(5);
    expect(report.longGapCount).toBe(5);

    const assessments = await prisma.riskAssessment.findMany({ where: { reportId: report.id } });
    expect(assessments).toHaveLength(25);
    for (const id of lapsedIds) {
      const a = assessments.find((x) => x.memberId === id)!;
      expect(["HIGH", "CRITICAL"]).toContain(a.category);
      const factors = a.factors as { key: string; detail: string; contribution: number }[];
      expect(factors[0]!.key).toBe("inactivity");
      expect(factors[0]!.detail).toMatch(/26 days since last visit/);
      expect(factors.map((f) => f.key)).toContain("expiry");
      // Explainable: every point of the score is attributable to a listed factor.
      expect(Math.round(factors.reduce((s, f) => s + f.contribution, 0))).toBeGreaterThanOrEqual(a.score - 3);
      expect(Math.round(factors.reduce((s, f) => s + f.contribution, 0))).toBeLessThanOrEqual(a.score + 3);
      expect(a.recommendedAction).toMatch(/Contact member/);
      expect(a.monthlyFeePaisa).toBe(150_000);
    }
    for (const id of healthyIds) {
      const a = assessments.find((x) => x.memberId === id)!;
      expect(a.category).not.toBe("CRITICAL");
      expect(a.score).toBeLessThan(assessments.find((x) => x.memberId === lapsedIds[0])!.score);
    }
    const factors = await prisma.predictionFactor.findMany({ where: { reportId: report.id }, orderBy: { sortOrder: "asc" } });
    expect(factors.find((f) => f.key === "gap")?.memberCount).toBe(5);
    const proj = await prisma.revenueProjection.findUniqueOrThrow({ where: { reportId: report.id } });
    expect(proj.averageFeePaisa).toBe(150_000);
    expect(proj.monthlyExposurePaisa).toBe(Math.round(report.estimatedAtRisk! * 150_000));
    expect(proj.rangeLowPaisa).toBe(report.rangeLow! * 150_000);
    expect(proj.rangeHighPaisa).toBe(report.rangeHigh! * 150_000);
  });

  it("LOW confidence with only ~30 days of history; INSUFFICIENT with too few members stores no numbers", async () => {
    const low = await seedGym({ healthy: 20, lapsed: 5, historyDays: 30, lapsedDays: 12 });
    const { report } = await generate(low.gym.id);
    expect(report.confidence).toBe("LOW");
    expect(report.estimatedAtRisk).not.toBeNull();

    const thin = await seedGym({ healthy: 4, lapsed: 1, historyDays: 90 });
    const { report: r2 } = await generate(thin.gym.id);
    expect(r2.confidence).toBe("INSUFFICIENT");
    expect(r2.insufficientReason).toMatch(/Only 5 members/);
    expect(r2.estimatedAtRisk).toBeNull();
    expect(r2.rangeLow).toBeNull();
    expect(await prisma.revenueProjection.count({ where: { reportId: r2.id } })).toBe(0);
  });

  it("risk statuses are written to members so Pulse can read them", async () => {
    const { gym, lapsedIds } = await seedGym({ healthy: 20, lapsed: 5, historyDays: 90, lapsedDays: 25 });
    await generate(gym.id);
    const rows = await prisma.member.findMany({ where: { id: { in: lapsedIds } } });
    expect(rows.every((m) => m.riskStatus === "AT_RISK" && (m.riskScore ?? 0) > 50)).toBe(true);
    expect(await prisma.riskHistory.count({ where: { gymId: gym.id, toStatus: "AT_RISK" } })).toBe(5);
  });
});

describe("predictions API", () => {
  it("POST queues exactly one prediction.generate job per minute; GET lists only this gym's reports; detail pages assessments", async () => {
    const { gym, lapsedIds } = await seedGym({ healthy: 20, lapsed: 5, historyDays: 90, lapsedDays: 25 });
    const foreign = await seedGym({ healthy: 20, lapsed: 5, historyDays: 90, lapsedDays: 25 });
    await generate(foreign.gym.id);
    await signInStaff(gym.id, "OWNER");
    expect(await prisma.job.count({ where: { gymId: gym.id, type: "prediction.generate" } })).toBe(0);
    const results = await Promise.all([request(req("/api/gym/predictions", { method: "POST", body: {} })), request(req("/api/gym/predictions", { method: "POST", body: {} }))]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.job.count({ where: { gymId: gym.id, type: "prediction.generate", status: "PENDING" } })).toBe(1);

    const job = await prisma.job.findFirstOrThrow({ where: { gymId: gym.id, type: "prediction.generate" } });
    await HANDLERS[job.type]!(job.payload as Record<string, unknown>, job);
    const reports = await json<{ id: string; confidence: string }[]>(await list(req("/api/gym/predictions")));
    expect(reports).toHaveLength(1);
    const d = await json<{ report: { id: string; factors: unknown[] }; assessments: { items: { category: string; score: number }[]; total: number } }>(
      await detail(req(`/api/gym/predictions/${reports[0]!.id}?category=ALL&pageSize=100`), params({ id: reports[0]!.id })),
    );
    expect(d.assessments.total).toBe(25);
    const scores = d.assessments.items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const crit = await json<{ assessments: { items: { category: string }[] } }>(await detail(req(`/api/gym/predictions/${reports[0]!.id}?category=CRITICAL`), params({ id: reports[0]!.id })));
    expect(crit.assessments.items.every((i) => i.category === "CRITICAL")).toBe(true);
    expect(lapsedIds.length).toBe(5);
    // Another gym's report is invisible.
    const fr = await prisma.predictionReport.findFirstOrThrow({ where: { gymId: foreign.gym.id } });
    expect((await detail(req(`/api/gym/predictions/${fr.id}`), params({ id: fr.id }))).status).toBe(404);
  });

  it("is refused to a trainer (no prediction.view) and signed-out callers", async () => {
    const { gym } = await makeGym();
    expect((await list(req("/api/gym/predictions"))).status).toBe(401);
    await signInStaff(gym.id, "TRAINER");
    expect((await list(req("/api/gym/predictions"))).status).toBe(403);
    expect((await request(req("/api/gym/predictions", { method: "POST", body: {} }))).status).toBe(403);
    expect(await prisma.job.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("is blocked when the churn_prediction feature is switched off for the gym", async () => {
    const { gym } = await makeGym();
    await prisma.featureFlag.create({ data: { key: "churn_prediction", scope: "GYM", scopeId: gym.id, enabled: false } });
    await signInStaff(gym.id, "OWNER");
    const res = await request(req("/api/gym/predictions", { method: "POST", body: {} }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.job.count({ where: { gymId: gym.id } })).toBe(0);
  });
});
