import { describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { today } from "@/lib/time";
import { dueForRenewal } from "@/services/memberships";
import { makeGym, makeMember } from "./helpers/fixtures";
import { giveMembership } from "./helpers/money";

const TZ = "Asia/Kathmandu";

describe("renewal list (desk Renew page)", () => {
  it("filters before limiting, and reports the true total so no due member is silently hidden", async () => {
    const { gym, plan } = await makeGym();
    const due = async (endOffset: number) => {
      const m = await makeMember(gym.id);
      await giveMembership(gym.id, m.id, plan.id, endOffset - 30, endOffset, TZ);
      return m;
    };
    // Ending soonest, but already renewed through another path (a later membership exists): must not count or
    // take a slot. The old page fetched 60 rows first and filtered these out afterwards.
    for (const off of [0, 1]) {
      const m = await due(off);
      await giveMembership(gym.id, m.id, plan.id, off + 1, off + 31, TZ);
    }
    const archived = await due(2);
    await prisma.member.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const expected = [await due(3), await due(5), await due(9), await due(-2)]; // -2: inside the grace period
    await due(20); // not due yet
    await due(-30); // long expired, outside grace

    const all = await dueForRenewal(tenantDb(gym.id), { today: today(TZ), graceDays: 7, take: 50 });
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => r.memberId).sort()).toEqual(expected.map((m) => m.id).sort());

    const capped = await dueForRenewal(tenantDb(gym.id), { today: today(TZ), graceDays: 7, take: 2 });
    expect(capped.total).toBe(4);
    expect(capped.rows.map((r) => r.memberId)).toEqual([expected[3]!.id, expected[0]!.id]); // soonest end first
  });

  it("never lists another gym's members", async () => {
    const { gym: a } = await makeGym();
    const { gym: b, plan: pb } = await makeGym();
    const m = await makeMember(b.id);
    await giveMembership(b.id, m.id, pb.id, -25, 5, TZ);
    const res = await dueForRenewal(tenantDb(a.id), { today: today(TZ), graceDays: 7, take: 50 });
    expect(res.total).toBe(0);
    expect(res.rows).toEqual([]);
  });
});
