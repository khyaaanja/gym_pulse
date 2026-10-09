import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { buildReport } from "@/services/reports";
import { placeOrder } from "@/services/marketplace";
import { makeGym, makeMember, makeProduct } from "./helpers/fixtures";

// 20:00 UTC on 1 Oct is 01:45 on 2 Oct in Kathmandu: the hours where UTC and the gym disagree about the date.
const EARLY_MORNING = new Date("2026-10-01T20:00:00Z");
const range = (d: string) => ({ from: d, to: d, days: 1 });

afterEach(() => vi.useRealTimers());

describe("dates are the gym's local dates", () => {
  it("a payment report files an early-morning payment under the gym's day, with that day's date", async () => {
    const { gym, plan } = await makeGym();
    const member = await makeMember(gym.id);
    await prisma.payment.create({ data: { gymId: gym.id, memberId: member.id, purpose: "MEMBERSHIP", method: "CASH", provider: "manual", reference: `GP-T-${Date.now()}-${Math.random()}`, amountPaisa: plan.pricePaisa, planId: plan.id, status: "SUCCEEDED", paidAt: EARLY_MORNING, createdAt: EARLY_MORNING } });

    const oct2 = await buildReport(gym.id, "payments", range("2026-10-02"));
    const rows = oct2.csv.trim().split("\n").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startsWith("2026-10-02,")).toBe(true);
    expect((await buildReport(gym.id, "payments", range("2026-10-01"))).csv.trim().split("\n")).toHaveLength(1); // header only
  });

  it("attendance exports show the gym's local check-in time", async () => {
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    await prisma.attendance.create({ data: { gymId: gym.id, memberId: member.id, checkedInAt: EARLY_MORNING, localDate: new Date("2026-10-02T00:00:00Z"), method: "STAFF" } });
    const csv = (await buildReport(gym.id, "attendance", range("2026-10-02"))).csv;
    expect(csv).toContain("2026-10-02,01:45,");
  });

  it("marketplace order numbers carry the gym's date", async () => {
    vi.useFakeTimers({ now: EARLY_MORNING, toFake: ["Date"] });
    const { gym } = await makeGym();
    const member = await makeMember(gym.id);
    const product = await makeProduct(gym.id);
    const order = await placeOrder(gym, member, [{ productId: product.id, quantity: 1 }]);
    expect(order.number).toMatch(/^ORD-261002-/);
  });
});
