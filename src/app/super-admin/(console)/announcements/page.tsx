import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export default async function Announcements() {
  await requireAdmin("announcements.manage");
  const [items, plans, gyms] = await Promise.all([prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }), prisma.saasPlan.findMany(), prisma.gym.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const roles = ["OWNER", "MANAGER", "STAFF", "TRAINER", "MEMBER"];
  return (
    <>
      <PageHeader title="Announcements" description="Target all gyms, a plan or one gym, and choose which roles see it." actions={
        <FormDialog trigger={<Button>New announcement</Button>} title="New announcement" endpoint="/api/admin/announcements" transform="admin.announcement" transformArgs={{ roles }} fields={[
          { name: "title", label: "Title", required: true }, { name: "body", label: "Message", type: "textarea", required: true },
          { name: "target", label: "Audience", type: "select", required: true, options: [{ value: "ALL", label: "All gyms" }, { value: "PLAN", label: "Gyms on a plan" }, { value: "GYM", label: "One gym" }] },
          { name: "planId", label: "Plan", type: "select", options: plans.map((p) => ({ value: p.id, label: p.name })) },
          { name: "gymId", label: "Gym", type: "select", options: gyms.map((g) => ({ value: g.id, label: g.name })) },
          ...roles.map((r) => ({ name: `r_${r}`, label: `Show to ${r.toLowerCase()}s`, type: "checkbox" as const, defaultValue: r === "OWNER" })),
          { name: "publishAt", label: "Schedule for", type: "datetime" }, { name: "expiresAt", label: "Expire at", type: "datetime" },
          { name: "publishNow", label: "Publish now", type: "checkbox" },
        ]} />
      } />
      <Card><CardBody>
        <ul className="divide-y divide-line">{items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="font-medium">{a.title}</p><p className="text-sm text-ink-2">{a.body}</p><p className="mt-1 text-xs text-ink-3">{a.target.toLowerCase()} · {a.roles.join(", ").toLowerCase() || "everyone"}{a.publishAt ? ` · from ${a.publishAt.toLocaleString("en-GB")}` : ""}{a.expiresAt ? ` · until ${a.expiresAt.toLocaleString("en-GB")}` : ""}</p></div>
            <StatusPill status={a.status} />
            {a.status !== "PUBLISHED" && a.status !== "EXPIRED" && <ActionButton size="sm" method="PATCH" endpoint={`/api/admin/announcements/${a.id}`} body={{ status: "PUBLISHED" }}>Publish</ActionButton>}
            {a.status === "PUBLISHED" && <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/announcements/${a.id}`} body={{ status: "EXPIRED" }}>Expire</ActionButton>}
          </li>
        ))}</ul>
      </CardBody></Card>
    </>
  );
}
