import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "@/lib/time";

describe("startOfLocalDay", () => {
  it("matches the old hardcoded +05:45 for Nepal gyms", () => {
    expect(startOfLocalDay("2026-10-06", "Asia/Kathmandu").toISOString()).toBe(new Date("2026-10-06T00:00:00+05:45").toISOString());
  });

  it("uses the gym's own timezone, including DST", () => {
    expect(startOfLocalDay("2026-10-06", "UTC").toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(startOfLocalDay("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfLocalDay("2026-12-01", "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
});
