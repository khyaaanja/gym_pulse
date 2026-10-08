import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { RiskBadge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/fields";

/** Privileged cross-gym search. Results are audited in each affected gym's log. */
export default async function Members({ searchParams }: PageProps<"/super-admin/members">) {
  const s = await requireAdmin("members.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const gymId = typeof sp.gymId === "string" && sp.gymId ? sp.gymId : undefined;
  const status = String(sp.status ?? "ALL");
  const gyms = await prisma.gym.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  let items: Awaited<ReturnType<typeof prisma.member.findMany<{ include: { gym: { select: { name: true } } } }>>> = [];
  if (q || gymId) {
    const where: Prisma.MemberWhereInput = { archivedAt: null, ...(gymId ? { gymId } : {}) };
    if (q) {
      const digits = q.replace(/\D/g, "");
      where.OR = [{ fullName: { contains: q, mode: "insensitive" } }, { memberCode: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
    }
    if (status === "AT_RISK" || status === "LOST") where.riskStatus = status;
    if (status === "ACTIVE") where.riskStatus = { in: ["ACTIVE", "ATTENTION"] };
    if (status === "SUSPENDED") where.status = "SUSPENDED";
    if (status === "EXPIRED") where.memberships = { none: { status: "ACTIVE" } };
    items = await prisma.member.findMany({ where, include: { gym: { select: { name: true } } }, orderBy: { fullName: "asc" }, take: 100 });
    for (const g of new Set(items.map((i) => i.gymId))) {
      await audit({ actor: { type: "PLATFORM_ADMIN", id: s.adminId, name: s.admin.name, role: s.admin.role }, action: "platform.member_records_accessed", entityType: "Member", gymId: g, metadata: { query: q || null, results: items.filter((i) => i.gymId === g).length } });
    }
  }
  return (
    <>
      <PageHeader title="Members" description="Search across all gyms. Access is logged in each gym's audit log." />
      <form className="mb-4 flex flex-wrap gap-2" action="/super-admin/members">
        <Input name="q" defaultValue={q} placeholder="Name, phone, email or membership ID" className="max-w-xs" aria-label="Search" />
        <Select name="gymId" defaultValue={gymId ?? ""} className="max-w-xs" aria-label="Gym"><option value="">All gyms</option>{gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
        <Select name="status" defaultValue={status} className="max-w-40" aria-label="Status">{["ALL", "ACTIVE", "AT_RISK", "EXPIRED", "SUSPENDED", "LOST"].map((x) => <option key={x} value={x}>{x.replace("_", " ").toLowerCase()}</option>)}</Select>
        <Button type="submit">Search</Button>
      </form>
      <Card><CardBody>
        {!q && !gymId ? <p className="text-sm text-ink-3">Search by name, phone, email or ID, or pick a gym.</p> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Gym</Th><Th>Phone</Th><Th>Status</Th><Th>Joined</Th></tr></thead>
            <tbody>{items.map((m) => <tr key={m.id}><Td className="font-medium">{m.fullName}<span className="block text-xs text-ink-3">{m.memberCode}</span></Td><Td>{m.gym.name}</Td><Td>{m.phone ?? "—"}</Td><Td><RiskBadge status={m.riskStatus} /></Td><Td>{m.joinedOn.toISOString().slice(0, 10)}</Td></tr>)}</tbody>
          </Table>
        )}
      </CardBody></Card>
    </>
  );
}
