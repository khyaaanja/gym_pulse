import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export default async function Vendors() {
  await requireAdmin("vendors.manage");
  const [vendors, gyms] = await Promise.all([
    prisma.marketplaceVendor.findMany({ include: { gyms: { where: { active: true }, include: { gym: { select: { id: true, name: true } } } }, _count: { select: { products: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    prisma.gym.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Vendors" description="Approve suppliers before they can list products. Suspending a vendor takes its listings off sale." actions={<FormDialog trigger={<Button>Add vendor</Button>} title="New vendor" endpoint="/api/admin/vendors" fields={[{ name: "name", label: "Business name", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "phone", label: "Phone" }, { name: "contactName", label: "Contact person" }, { name: "panNumber", label: "PAN number" }, { name: "description", label: "Description", type: "textarea" }]} />} />
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Vendor</Th><Th>Status</Th><Th>Gyms</Th><Th className="text-right">Listings</Th><Th /></tr></thead>
          <tbody>{vendors.map((v) => (
            <tr key={v.id}>
              <Td className="font-medium">{v.name}<span className="block text-xs text-ink-3">{v.email}{v.panNumber ? ` · PAN ${v.panNumber}` : ""}</span></Td>
              <Td><StatusPill status={v.status} /></Td>
              <Td className="text-sm text-ink-2">{v.gyms.map((g) => g.gym.name).join(", ") || "—"}</Td>
              <Td className="num text-right">{v._count.products}</Td>
              <Td className="text-right"><div className="flex flex-wrap justify-end gap-1">
                {v.status !== "APPROVED" && <ActionButton size="sm" method="PATCH" endpoint={`/api/admin/vendors/${v.id}`} body={{ status: "APPROVED" }} success="Vendor approved">Approve</ActionButton>}
                {v.status === "PENDING" && <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/vendors/${v.id}`} body={{ status: "REJECTED" }}>Reject</ActionButton>}
                {v.status === "APPROVED" && <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/vendors/${v.id}`} body={{ status: "SUSPENDED" }} confirm={`Suspend ${v.name}? Their listings come off sale.`}>Suspend</ActionButton>}
                <FormDialog trigger={<Button size="sm" variant="secondary">Link gym</Button>} title={`Let ${v.name} sell at…`} method="PATCH" endpoint={`/api/admin/vendors/${v.id}`} fields={[{ name: "linkGymId", label: "Gym", type: "select", required: true, options: gyms.map((g) => ({ value: g.id, label: g.name })) }]} />
              </div></Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
