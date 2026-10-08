import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getUserSession } from "@/lib/auth/session";
import { prisma } from "@/db/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { ActionButton } from "@/components/ui/action-button";
import { Preferences } from "@/components/app/preferences";
import { PushSettings } from "@/components/app/push-settings";
import { InboxRow } from "@/components/app/notification-center";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function Notifications({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const s = await getUserSession();
  if (!s) redirect("/login");
  const onlyUnread = (await searchParams).filter === "unread";
  const mine = { userId: s.userId, channel: "IN_APP" as const };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { ...mine, ...(onlyUnread ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.notification.count({ where: { ...mine, readAt: null } }),
  ]);
  const tab = (active: boolean) => cn("rounded-full px-3.5 py-1.5 text-sm font-medium", active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" actions={unread ? <ActionButton variant="secondary" endpoint="/api/notifications" body={{ all: true }} success="All marked as read">Mark all read</ActionButton> : undefined} />
      <nav aria-label="Filter notifications" className="mb-3 flex gap-1">
        <Link href="/app/notifications" className={tab(!onlyUnread)} aria-current={!onlyUnread ? "page" : undefined}>All</Link>
        <Link href="/app/notifications?filter=unread" className={tab(onlyUnread)} aria-current={onlyUnread ? "page" : undefined}>Unread{unread > 0 && ` (${unread})`}</Link>
      </nav>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Bell />} title="You're all caught up" body={onlyUnread ? "No unread notifications." : "At-risk alerts, renewals, payments and bookings will show up here."} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[inherit]">
            {items.map((n) => (
              <InboxRow key={n.id} n={{ id: n.id, category: n.category, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }} />
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-4" id="preferences">
        <CardHeader title="Phone & desktop alerts" description="Push notifications arrive even when GymPulse is closed." />
        <CardBody><PushSettings /></CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Notification preferences" description="Choose how you hear about each kind of update. Security messages are always sent." />
        <CardBody><Preferences /></CardBody>
      </Card>
    </div>
  );
}
