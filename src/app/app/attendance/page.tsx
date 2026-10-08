import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { appMode } from "@/lib/page-auth";
import { redirect } from "next/navigation";
import { today as todayIn, toDbDate, addDays, startOfLocalDay } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { CheckInDesk } from "@/components/app/checkin-desk";
import { activeLocations, visitsByLocation } from "@/services/locations";
import { MemberAttendance } from "@/components/app/member-attendance";
import { checkInsOn } from "@/services/attendance";

export const metadata = { title: "Attendance" };

export default async function Attendance() {
  const mode = await appMode();
  if (mode.kind === "member") return <MemberAttendance ctx={mode.ctx} />;
  if (mode.kind !== "staff") redirect("/login");
  const ctx = mode.ctx;
  if (!ctx.can("attendance.view")) redirect("/app/forbidden");
  const today = todayIn(ctx.gym.timezone);
  const [todayList, week, month, active, duplicates, locations, byBranch] = await Promise.all([
    // Trainers see only their own members' check-ins; the totals below are gym-wide counts with no names.
    checkInsOn(ctx, today),
    ctx.db.attendance.count({ where: { localDate: { gte: toDbDate(addDays(today, -6)) } } }),
    ctx.db.attendance.count({ where: { localDate: { gte: toDbDate(addDays(today, -29)) } } }),
    ctx.db.member.count({ where: { archivedAt: null, riskStatus: { in: ["ACTIVE", "ATTENTION", "AT_RISK"] } } }),
    ctx.db.checkIn.count({ where: { outcome: "DUPLICATE", createdAt: { gte: startOfLocalDay(today, ctx.gym.timezone) } } }),
    activeLocations(ctx.gym.id),
    visitsByLocation(ctx.gym.id, toDbDate(addDays(today, -29)), toDbDate(addDays(today, 1))),
  ]);
  const multi = locations.length > 1 || byBranch.length > 1;
  return (
    <>
      <PageHeader title="Attendance" description="Check members in at the desk, or let them scan the kiosk code with their phone." actions={ctx.can("attendance.create") ? <Button asChild variant="secondary"><Link href="/app/kiosk" target="_blank"><MonitorSmartphone /> Open kiosk QR</Link></Button> : undefined} />
      {ctx.can("attendance.create") && ctx.flags.attendance && (
        <Card className="mb-6"><CardBody><CheckInDesk locations={locations} /></CardBody></Card>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Today" value={todayList.length} period="Check-ins" />
        <Metric label="This week" value={week} period="Last 7 days" />
        <Metric label="This month" value={month} period="Last 30 days" />
        <Metric label="Avg. visits / member" value={active ? (month / active).toFixed(1) : "—"} period="Last 30 days" definition="Check-ins in the last 30 days ÷ members who aren't lost." />
      </div>
      <Card className="mt-6">
        <CardHeader title="Checked in today" description={duplicates ? `${duplicates} repeat scans were ignored (one check-in per member per day).` : undefined} />
        <CardBody>
          {todayList.length === 0 ? (
            <EmptyState title="No check-ins yet today" body="They'll appear here as members arrive." />
          ) : (
            <Table>
              <thead><tr><Th>Time</Th><Th>Member</Th><Th>Method</Th>{multi && <Th>Branch</Th>}<Th className="text-right">Streak</Th></tr></thead>
              <tbody>
                {todayList.map((a) => (
                  <tr key={a.id}>
                    <Td className="num">{a.checkedInAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ctx.gym.timezone })}</Td>
                    <Td><Link className="font-medium hover:underline" href={`/app/members/${a.member.id}`}>{a.member.fullName}</Link> <span className="text-ink-3">{a.member.memberCode}</span></Td>
                    <Td className="text-ink-2">{a.method === "QR" ? "Phone scan" : a.method === "STAFF" ? "Front desk" : a.method}</Td>
                    {multi && <Td className="text-ink-2">{a.location?.name ?? "—"}</Td>}
                    <Td className="num text-right">{a.member.currentStreak}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      {multi && (
        <Card className="mt-6">
          <CardHeader title="Visits by branch" description="Last 30 days" />
          <CardBody>
            <ul className="space-y-3">
              {byBranch.map((b) => {
                const total = Math.max(1, byBranch.reduce((x, y) => x + y.visits, 0));
                return (
                  <li key={b.id ?? "none"} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                    <span className="truncate font-medium">{b.name}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${(b.visits / total) * 100}%` }} /></span>
                    <span className="num text-ink-2">{b.visits} <span className="text-ink-3">({Math.round((b.visits / total) * 100)}%)</span></span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
