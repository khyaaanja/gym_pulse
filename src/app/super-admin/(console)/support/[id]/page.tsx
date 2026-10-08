import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";

export default async function Ticket({ params }: PageProps<"/super-admin/support/[id]">) {
  await requireAdmin("support.manage");
  const { id } = await params;
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } }, assignedAdmin: true } });
  if (!t) notFound();
  const [admins, gym] = await Promise.all([prisma.platformAdmin.findMany({ where: { disabledAt: null, role: { in: ["SUPER_ADMIN", "SUPPORT_ADMIN"] } }, select: { id: true, name: true } }), t.gymId ? prisma.gym.findUnique({ where: { id: t.gymId }, select: { name: true } }) : null]);
  return (
    <>
      <PageHeader title={`#${t.number} ${t.subject}`} description={`${gym?.name ?? "No gym"} · ${t.requesterEmail} · opened ${t.createdAt.toLocaleString("en-GB")}`} actions={
        <>
          <FormDialog trigger={<Button variant="secondary">Update</Button>} title="Update ticket" endpoint={`/api/admin/tickets/${t.id}`} method="PATCH" fields={[
            { name: "status", label: "Status", type: "select", required: true, defaultValue: t.status, options: ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })) },
            { name: "priority", label: "Priority", type: "select", required: true, defaultValue: t.priority, options: ["LOW", "NORMAL", "HIGH", "URGENT"].map((s) => ({ value: s, label: s.toLowerCase() })) },
            { name: "assignedAdminId", label: "Assigned to", type: "select", defaultValue: t.assignedAdminId, options: admins.map((a) => ({ value: a.id, label: a.name })) },
          ]} />
          <FormDialog trigger={<Button>Reply</Button>} title="Reply" endpoint={`/api/admin/tickets/${t.id}`} transform="admin.ticketReply" fields={[{ name: "body", label: "Message", type: "textarea", required: true }, { name: "internal", label: "Internal note (not visible to the gym)", type: "checkbox" }]} />
        </>
      } />
      <div className="mb-4 flex gap-2"><StatusPill status={t.status} /><Badge>{t.priority.toLowerCase()}</Badge><Badge tone={t.slaDueAt < new Date() && !["RESOLVED", "CLOSED"].includes(t.status) ? "risk" : "neutral"}>SLA {t.slaDueAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Badge></div>
      <Card>
        <CardHeader title="Conversation" />
        <CardBody>
          <ul className="space-y-3">{t.messages.map((m) => <li key={m.id} className={`rounded-2xl p-4 ${m.internal ? "bg-warn-soft" : m.authorType === "ADMIN" ? "bg-brand-soft" : "bg-mist"}`}><p className="text-sm font-medium">{m.authorName}{m.internal ? " · internal note" : ""} <span className="font-normal text-ink-3">· {m.createdAt.toLocaleString("en-GB")}</span></p><p className="mt-1 whitespace-pre-line text-sm">{m.body}</p></li>)}</ul>
        </CardBody>
      </Card>
    </>
  );
}
