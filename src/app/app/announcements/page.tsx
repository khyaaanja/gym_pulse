import { Megaphone } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { formatDate, localDate } from "@/lib/time";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export const metadata = { title: "Announcements" };

const AUDIENCE_LABEL = { MEMBERS: "Members", STAFF: "Staff", EVERYONE: "Everyone" } as const;
const audienceOf = (roles: string[]) => (roles.length === 0 ? "EVERYONE" : roles.includes("MEMBER") ? "MEMBERS" : "STAFF");

export default async function Announcements() {
  const ctx = await requireStaff("settings.manage");
  const rows = await prisma.announcement.findMany({ where: { target: "GYM", gymId: ctx.gym.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const now = new Date();
  const live = (a: (typeof rows)[number]) => a.status === "PUBLISHED" && (!a.expiresAt || a.expiresAt > now);
  const fields = (a?: (typeof rows)[number]): FieldSpec[] => [
    { name: "title", label: "Headline", required: true, defaultValue: a?.title, placeholder: "Closed on Saturday for Dashain" },
    { name: "body", label: "Message", type: "textarea", required: true, defaultValue: a?.body, placeholder: "We reopen Sunday at 6 AM. Happy Dashain!" },
    { name: "audience", label: "Who sees it", type: "select", required: true, defaultValue: a ? audienceOf(a.roles) : "MEMBERS", options: Object.entries(AUDIENCE_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "expiresAt", label: "Stop showing it on", type: "date", defaultValue: a?.expiresAt ? localDate(a.expiresAt, ctx.gym.timezone) : null, hint: "Optional. Leave empty to show it until you end it." },
    ...(a ? [] : [{ name: "publish", label: "Publish now (untick to save as a draft)", type: "checkbox" as const, defaultValue: true }]),
  ];
  return (
    <>
      <PageHeader title="Announcements" description="News for your members and staff. Published announcements appear on their home screen." actions={<FormDialog trigger={<Button>New announcement</Button>} title="New announcement" endpoint="/api/gym/announcements" fields={fields()} transform="gym.announcement" transformArgs={{ tz: ctx.gym.timezone }} successMessage="Announcement saved" />} />
      {rows.length === 0 ? (
        <Card><EmptyState icon={<Megaphone />} title="No announcements yet" body="Tell members about holiday hours, new classes or equipment. They'll see it on their home screen." /></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <Card key={a.id}>
              <CardBody className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{a.title}</p>
                    {live(a) ? <Badge tone="ok" dot>Live</Badge> : a.status === "DRAFT" ? <Badge>Draft</Badge> : <Badge tone="neutral">Ended</Badge>}
                    <Badge tone="brand">{AUDIENCE_LABEL[audienceOf(a.roles)]}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{a.body}</p>
                  <p className="mt-2 text-xs text-ink-3">{a.publishAt ? `Published ${formatDate(a.publishAt, undefined, ctx.gym.timezone)}` : `Created ${formatDate(a.createdAt, undefined, ctx.gym.timezone)}`}{a.expiresAt ? ` · ${a.expiresAt > now ? "shows until" : "ended"} ${formatDate(a.expiresAt, undefined, ctx.gym.timezone)}` : ""}</p>
                </div>
                <div className="flex gap-1">
                  <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title="Edit announcement" endpoint={`/api/gym/announcements/${a.id}`} method="PATCH" fields={fields(a)} transform="gym.announcement" transformArgs={{ edit: true, tz: ctx.gym.timezone }} />
                  {live(a) ? (
                    <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/announcements/${a.id}`} body={{ status: "EXPIRED" }} success="Announcement ended">End</ActionButton>
                  ) : (
                    <ActionButton size="sm" variant="secondary" method="PATCH" endpoint={`/api/gym/announcements/${a.id}`} body={{ status: "PUBLISHED", expiresAt: null }} success="Announcement published">Publish</ActionButton>
                  )}
                  <ActionButton size="sm" variant="ghost" method="DELETE" endpoint={`/api/gym/announcements/${a.id}`} confirm="Delete this announcement? This can't be undone." success="Deleted">Delete</ActionButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
