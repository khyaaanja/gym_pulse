import { describe, expect, it } from "vitest";
import { TRANSFORMS } from "@/components/ui/transforms";
import { localDate } from "@/lib/time";

// FormDialog turns a `type: "date"` field into an ISO instant at UTC midnight (form-dialog.tsx submit()).
const dateField = (d: string) => new Date(d).toISOString();

describe("date transforms pin the picked day to the gym's timezone", () => {
  it("announcement end date is a valid instant at 23:59:59 local (was Invalid Date)", () => {
    const body = TRANSFORMS["gym.announcement"]({ title: "t", body: "b", audience: "ALL", expiresAt: dateField("2026-12-31") }, { tz: "Asia/Kathmandu" });
    expect(body.expiresAt).toBe("2026-12-31T18:14:59.000Z");
    expect(Number.isNaN(new Date(body.expiresAt!).getTime())).toBe(false);
  });

  it("defaults to Nepal time when no tz is passed", () => {
    expect(TRANSFORMS["gym.announcement"]({ expiresAt: dateField("2026-12-31") }).expiresAt).toBe("2026-12-31T18:14:59.000Z");
  });

  it("offer start/end follow a non-Nepal gym timezone", () => {
    const body = TRANSFORMS["gym.promotion"]({ title: "x", startsAt: dateField("2026-07-01"), endsAt: dateField("2026-07-31") }, { tz: "America/New_York" });
    expect(body.startsAt).toBe("2026-07-01T04:00:00.000Z");
    expect(body.endsAt).toBe("2026-08-01T03:59:59.000Z");
  });

  it("coupon 'valid until' a day lasts through the end of that day in the gym's timezone", () => {
    expect(TRANSFORMS["gym.coupon"]({ code: "X", validUntil: dateField("2026-10-31") }, { tz: "Asia/Kathmandu" }).validUntil).toBe("2026-10-31T18:14:59.000Z");
    expect(TRANSFORMS["gym.coupon"]({ code: "X", validUntil: null }, { tz: "Asia/Kathmandu" }).validUntil).toBeNull();
  });

  it("round-trips: the edit form's default shows the same day that was saved", () => {
    for (const tz of ["Asia/Kathmandu", "America/New_York", "Pacific/Auckland"]) {
      const body = TRANSFORMS["gym.promotion"]({ startsAt: dateField("2026-03-10"), endsAt: dateField("2026-03-20") }, { tz });
      expect(localDate(new Date(body.startsAt!), tz)).toBe("2026-03-10");
      expect(localDate(new Date(body.endsAt!), tz)).toBe("2026-03-20");
    }
  });
});
