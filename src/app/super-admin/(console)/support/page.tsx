import Link from "next/link";
import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";

export default async function Support({ searchParams }: PageProps<"/super-admin/support">) {
  await requireAdmin("support.manage");
  const { status = "OPEN_ALL" } = await searchParams;
  const where = status === "ALL" ? {} : status === "OPEN_ALL" ? { status: { in: ["OPEN" as const, "IN_PROGRESS" as const, "WAITING" as const] } } : { status: String(status) as "OPEN" };
  const tickets = await prisma.supportTicket.findMany({ where, include: { assignedAdmin: { select: { name: true } } }, orderBy: { slaDueAt: "asc" }, take: 200 });
  const gyms = await prisma.gym.findMany({ where: { id: { in: tickets.map((t) => t.gymId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Support" description="Tickets sorted by SLA deadline." />
      <div className="mb-4 flex flex-wrap gap-1">{["OPEN_ALL", "OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED", "ALL"].map((s) => <Link key={s} href={`/super-admin/support?status=${s}`} className={`rounded-full px-3 py-1.5 text-sm ${status === s ? "bg-ink text-mist" : "text-ink-2"}`}>{s === "OPEN_ALL" ? "Needs action" : s.replace("_", " ").toLowerCase()}</Link>)}</div>
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Ticket</Th><Th>Gym</Th><Th>Priority</Th><Th>Status</Th><Th>SLA</Th><Th>Assigned</Th></tr></thead>
          <tbody>{tickets.map((t) => {
            const breached = !["RESOLVED", "CLOSED"].includes(t.status) && t.slaDueAt < new Date();
            return (
              <tr key={t.id}>
                <Td><Link href={`/super-admin/support/${t.id}`} className="font-medium hover:underline">#{t.number} {t.subject}</Link><span className="block text-xs text-ink-3">{t.requesterEmail} · {t.category}</span></Td>
                <Td>{gyms.find((g) => g.id === t.gymId)?.name ?? "—"}</Td>
                <Td><Badge tone={t.priority === "URGENT" || t.priority === "HIGH" ? "risk" : "neutral"}>{t.priority.toLowerCase()}</Badge></Td>
                <Td><StatusPill status={t.status} /></Td>
                <Td className={breached ? "font-medium text-risk" : "text-ink-2"}>{breached ? "Breached · " : ""}{t.slaDueAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td>
                <Td className="text-ink-2">{t.assignedAdmin?.name ?? "—"}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
