import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { MagnitudeBars, AttendanceChart } from "@/components/app/charts";

export default async function Analytics() {
  await requireAdmin("analytics.view");
  const [checkins, byCity, perGym] = await Promise.all([
    prisma.$queryRaw<{ d: Date; n: bigint }[]>`SELECT "localDate" AS d, COUNT(*) AS n FROM "Attendance" WHERE "localDate" >= CURRENT_DATE - 60 AND "localDate" < CURRENT_DATE GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ city: string | null; n: bigint }[]>`SELECT COALESCE("city", 'Unknown') AS city, COUNT(*) AS n FROM "Gym" WHERE "status" <> 'ARCHIVED' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    prisma.$queryRaw<{ id: string; name: string; members: bigint; at_risk: bigint; recovered: bigint; protected: bigint | null }[]>`
      SELECT g."id", g."name",
        (SELECT COUNT(*) FROM "Member" m WHERE m."gymId" = g."id" AND m."archivedAt" IS NULL) AS members,
        (SELECT COUNT(*) FROM "Member" m WHERE m."gymId" = g."id" AND m."riskStatus" = 'AT_RISK' AND m."archivedAt" IS NULL) AS at_risk,
        (SELECT COUNT(*) FROM "RecoveryTask" t WHERE t."gymId" = g."id" AND t."status" IN ('RETURNED','RENEWED')) AS recovered,
        (SELECT SUM(t."protectedRevenuePaisa") FROM "RecoveryTask" t WHERE t."gymId" = g."id") AS protected
      FROM "Gym" g WHERE g."status" <> 'ARCHIVED' ORDER BY members DESC LIMIT 25`,
  ]);
  return (
    <>
      <PageHeader title="Analytics" description="Platform-wide engagement and retention." />
      <div className="grid-cols-1 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card><CardHeader title="Daily check-ins, all gyms" description="Last 60 days" /><CardBody><AttendanceChart data={checkins.map((c) => ({ date: c.d.toISOString().slice(0, 10), visits: Number(c.n) }))} /></CardBody></Card>
        <Card><CardHeader title="Gyms by city" /><CardBody><MagnitudeBars unit="gyms" data={byCity.map((c) => ({ label: c.city ?? "Unknown", value: Number(c.n) }))} /></CardBody></Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Retention by gym" description="Recovered = at-risk members who returned or renewed after follow-up. Protected revenue is an estimate." />
        <CardBody>
          <Table><thead><tr><Th>Gym</Th><Th className="text-right">Members</Th><Th className="text-right">At risk</Th><Th className="text-right">Share at risk</Th><Th className="text-right">Recovered</Th><Th className="text-right">Est. protected</Th></tr></thead>
            <tbody>{perGym.map((g) => <tr key={g.id}><Td className="font-medium">{g.name}</Td><Td className="num text-right">{Number(g.members)}</Td><Td className="num text-right">{Number(g.at_risk)}</Td><Td className="num text-right">{Number(g.members) ? `${Math.round((Number(g.at_risk) / Number(g.members)) * 100)}%` : "—"}</Td><Td className="num text-right">{Number(g.recovered)}</Td><Td className="num text-right">{formatMoney(Number(g.protected ?? 0))}</Td></tr>)}</tbody></Table>
        </CardBody>
      </Card>
    </>
  );
}
