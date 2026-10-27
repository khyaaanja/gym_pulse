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
  const statusFilter = String(sp.status ?? "ALL");
  const gyms = await prisma.gym.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  let where: Prisma.MemberWhereInput = {};
  
  // Build where clause based on status filter
  if (statusFilter === "ALL") {
    where = {};
  } else if (statusFilter === "ACTIVE") {
    where = { archivedAt: null, riskStatus: { in: ["ACTIVE", "ATTENTION"] } };
  } else if (statusFilter === "ARCHIVED") {
    where = { archivedAt: { not: null } };
  } else if (statusFilter === "AT_RISK" || statusFilter === "LOST") {
    where = { riskStatus: statusFilter, archivedAt: null };
  } else if (statusFilter === "SUSPENDED") {
    where = { status: "SUSPENDED", archivedAt: null };
  } else if (statusFilter === "EXPIRED") {
    where = { archivedAt: null, memberships: { none: { status: "ACTIVE" } } };
  }
  
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [{ fullName: { contains: q, mode: "insensitive" } }, { memberCode: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
  }
  if (gymId) where.gymId = gymId;
  
  const allItems = await prisma.member.findMany({ where, include: { gym: { select: { id: true, name: true } } }, orderBy: { fullName: "asc" } });
  const items = statusFilter === "ARCHIVED" ? allItems : allItems.filter((m) => m.archivedAt === null || statusFilter !== "ARCHIVED");
  
  for (const g of new Set(items.map((i) => i.gymId))) {
    await audit({ actor: { type: "PLATFORM_ADMIN", id: s.adminId, name: s.admin.name, role: s.admin.role }, action: "platform.member_records_accessed", entityType: "Member", gymId: g, metadata: { query: q || null, results: items.filter((i) => i.gymId === g).length } });
  }
  return (
    <>
      <PageHeader title="Members" description="Search across all gyms. Access is logged in each gym's audit log." />
      <form className="mb-4 flex flex-wrap gap-2" action="/super-admin/members">
        <Input name="q" defaultValue={q} placeholder="Name, phone, email or membership ID" className="max-w-xs" aria-label="Search" />
        <Select name="gymId" defaultValue={gymId ?? ""} className="max-w-xs" aria-label="Gym"><option value="">All gyms</option>{gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
        <Select name="status" defaultValue={statusFilter} className="max-w-40" aria-label="Status">
          <option value="ALL">All</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
          <option value="AT_RISK">At Risk</option>
          <option value="LOST">Lost</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="EXPIRED">Expired</option>
        </Select>
        <Button type="submit">Search</Button>
      </form>
      <Card><CardBody>
        {!q && !gymId ? <p className="text-sm text-ink-3">Search by name, phone, email or ID, or pick a gym.</p> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Gym</Th><Th>Phone</Th><Th>Status</Th><Th>Joined</Th><Th>Actions</Th></tr></thead>
            <tbody>{items.map((m) => {
              const isArchived = m.archivedAt !== null;
              const statusText = isArchived ? "Archived" : (m.riskStatus || "ACTIVE");
              return (
                <tr key={m.id}>
                  <Td className="font-medium">{m.fullName}<span className="block text-xs text-ink-3">{m.memberCode}</span></Td>
                  <Td>{m.gym.name}</Td>
                  <Td>{m.phone ?? "—"}</Td>
                  <Td><RiskBadge status={m.riskStatus} />{isArchived ? " · Archived" : ""}</Td>
                  <Td>{m.joinedOn.toISOString().slice(0, 10)}</Td>
                  <Td>
                    {isArchived && ctx.can("members.edit") ? (
                      <ActionButton 
                        variant="ghost" 
                        className="text-ok" 
                        method="PATCH" 
                        endpoint={`/api/gym/members/${m.id}`} 
                        confirm={`Unarchive ${m.fullName}? They'll return to active lists.`} 
                        success="Member unarchived" 
                        redirectTo="/super-admin/members"
                      >
                        Unarchive
                      </ActionButton>
                    ) : null}
                  </Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
      </CardBody></Card>
    </>
  );
}
