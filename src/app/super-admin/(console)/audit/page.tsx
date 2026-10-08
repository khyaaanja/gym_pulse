import Link from "next/link";
import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

export default async function Audit({ searchParams }: PageProps<"/super-admin/audit">) {
  await requireAdmin("audit.view");
  const sp = await searchParams;
  const action = typeof sp.action === "string" ? sp.action.slice(0, 60) : "";
  const actorType = ["PLATFORM_ADMIN", "USER", "SYSTEM", "DEVICE"].includes(String(sp.actor)) ? (String(sp.actor) as "USER") : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = { ...(action ? { action: { contains: action } } : {}), ...(actorType ? { actorType } : {}) };
  const [logs, gyms] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }), prisma.gym.findMany({ select: { id: true, name: true } })]);
  return (
    <>
      <PageHeader title="Audit logs" description="Privileged actions across the platform, with before/after state where recorded." />
      <form className="mb-4 flex flex-wrap gap-2" action="/super-admin/audit">
        <Input name="action" defaultValue={action} placeholder="Action contains… (e.g. gyms.suspended)" className="max-w-xs" aria-label="Action" />
        <Select name="actor" defaultValue={actorType ?? ""} className="max-w-48" aria-label="Actor"><option value="">Any actor</option><option value="PLATFORM_ADMIN">Platform admin</option><option value="USER">Gym user</option><option value="SYSTEM">System</option></Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Card><CardBody>
        <Table>
          <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Gym</Th><Th>Details</Th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l.id} className="align-top">
              <Td className="whitespace-nowrap">{l.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td>
              <Td>{l.actorName ?? l.actorType.toLowerCase()}<span className="block text-xs text-ink-3">{l.actorRole?.toLowerCase()}{l.ip ? ` · ${l.ip}` : ""}</span></Td>
              <Td className="font-medium">{l.action}</Td>
              <Td className="text-ink-2">{l.entityType}</Td>
              <Td>{gyms.find((g) => g.id === l.gymId)?.name ?? "—"}</Td>
              <Td>{(l.before || l.after || l.metadata) && <details className="text-xs"><summary className="cursor-pointer text-brand">View</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded-lg bg-mist p-2">{JSON.stringify({ before: l.before, after: l.after, metadata: l.metadata }, null, 1).slice(0, 2000)}</pre></details>}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <div className="mt-4 flex justify-end gap-2 text-sm">
          {page > 1 && <Link className="rounded-xl px-3 py-1.5 ring-1 ring-line" href={`/super-admin/audit?${new URLSearchParams({ action, actor: actorType ?? "", page: String(page - 1) })}`}>Previous</Link>}
          {logs.length === 50 && <Link className="rounded-xl px-3 py-1.5 ring-1 ring-line" href={`/super-admin/audit?${new URLSearchParams({ action, actor: actorType ?? "", page: String(page + 1) })}`}>Next</Link>}
        </div>
      </CardBody></Card>
    </>
  );
}
