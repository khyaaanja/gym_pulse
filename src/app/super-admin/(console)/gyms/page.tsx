import Link from "next/link";
import { requireAdmin } from "@/lib/page-auth";
import { adminCan } from "@/lib/rbac";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { FormDialog } from "@/components/ui/form-dialog";

export default async function Gyms({ searchParams }: PageProps<"/super-admin/gyms">) {
  const s = await requireAdmin("gyms.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"].includes(String(sp.status)) ? (String(sp.status) as "ACTIVE") : undefined;
  const gyms = await prisma.gym.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { plan: true, _count: { select: { members: { where: { archivedAt: null } } } }, staff: { where: { role: "OWNER" }, include: { user: { select: { name: true, email: true } } }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <>
      <PageHeader title="Gyms" actions={adminCan(s.admin.role, "gyms.manage") ? (
        <FormDialog trigger={<Button>Create gym</Button>} title="Create gym" description="The owner must change this temporary password at first sign-in." endpoint="/api/admin/gyms" successMessage="Gym created" fields={[
          { name: "gymName", label: "Gym name", required: true }, { name: "city", label: "City" }, { name: "ownerName", label: "Owner name", required: true },
          { name: "email", label: "Owner email", type: "email", required: true }, { name: "phone", label: "Owner mobile", type: "tel" }, { name: "password", label: "Temporary password", type: "password", required: true },
        ]} />
      ) : undefined} />
      <form className="mb-4 flex flex-wrap gap-2" action="/super-admin/gyms">
        <Input name="q" defaultValue={q} placeholder="Search gyms or cities" className="max-w-xs" aria-label="Search gyms" />
        <Button variant="secondary" type="submit">Search</Button>
        {[undefined, "TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"].map((st) => <Link key={st ?? "all"} href={`/super-admin/gyms${st ? `?status=${st}` : ""}`} className={`rounded-full px-3 py-2 text-sm ${status === st ? "bg-ink text-mist" : "text-ink-2"}`}>{st ? st.toLowerCase() : "all"}</Link>)}
      </form>
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Gym</Th><Th>Owner</Th><Th>Plan</Th><Th className="text-right">Members</Th><Th>Status</Th><Th>Created</Th></tr></thead>
          <tbody>{gyms.map((g) => (
            <tr key={g.id}>
              <Td><Link href={`/super-admin/gyms/${g.id}`} className="font-medium hover:underline">{g.name}</Link><span className="block text-xs text-ink-3">{[g.city, g.province].filter(Boolean).join(", ")}</span></Td>
              <Td className="text-ink-2">{g.staff[0]?.user.name}<span className="block text-xs text-ink-3">{g.staff[0]?.user.email}</span></Td>
              <Td>{g.plan?.name ?? "—"}</Td>
              <Td className="num text-right">{g._count.members}</Td>
              <Td><StatusPill status={g.status} /></Td>
              <Td className="whitespace-nowrap text-ink-2">{g.createdAt.toLocaleDateString("en-GB")}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
