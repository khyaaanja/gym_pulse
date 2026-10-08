import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { daysAgo } from "@/lib/time";
import { decryptJson } from "@/lib/crypto";
import { PROVIDER_CATALOG } from "@/services/notifications/providers";
import { TEMPLATE_KEYS } from "@/services/notifications/templates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

const NEXT: Record<string, string[]> = { DRAFT: ["REVIEW"], REVIEW: ["PUBLISHED", "DRAFT"], PUBLISHED: ["ARCHIVED"], ARCHIVED: [] };

export default async function Notifications({ searchParams }: PageProps<"/super-admin/notifications">) {
  await requireAdmin("notifications.manage");
  const { key = "RENEWAL_REMINDER" } = await searchParams;
  const selected = String(key) in TEMPLATE_KEYS ? String(key) : "RENEWAL_REMINDER";
  const [configs, stats, templates] = await Promise.all([
    prisma.notificationProviderConfig.findMany(),
    prisma.notification.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: daysAgo(30) } }, _count: true }),
    prisma.notificationTemplate.findMany({ where: { gymId: null, key: selected }, orderBy: [{ channel: "asc" }, { version: "desc" }] }),
  ]);
  return (
    <>
      <PageHeader title="Notifications" description="Providers and message templates. Channels without a configured provider are skipped and recorded as “Not configured” — never shown as sent." />
      <Card>
        <CardHeader title="Providers" description="Last 30 days of usage. Credentials are write-only." />
        <CardBody>
          <Table>
            <thead><tr><Th>Provider</Th><Th>Channel</Th><Th>Status</Th><Th className="text-right">Sent</Th><Th className="text-right">Failed</Th><Th className="text-right">Delivery rate</Th><Th>Daily limit</Th><Th /></tr></thead>
            <tbody>
              {PROVIDER_CATALOG.map((p) => {
                const row = configs.find((c) => c.providerKey === p.key);
                const creds = decryptJson<Record<string, string>>(row?.credentialsEnc) ?? {};
                const ch = stats.filter((s) => s.channel === p.channel);
                const total = ch.reduce((a, s) => a + s._count, 0);
                const sent = ch.filter((s) => s.status === "SENT" || s.status === "DELIVERED").reduce((a, s) => a + s._count, 0);
                const failed = ch.filter((s) => s.status === "FAILED").reduce((a, s) => a + s._count, 0);
                return (
                  <tr key={p.key}>
                    <Td className="font-medium">{p.name}</Td><Td>{p.channel.toLowerCase()}</Td>
                    <Td>{row?.enabled ? <StatusPill status="ACTIVE" /> : <span className="text-sm text-ink-3">Not configured</span>}</Td>
                    <Td className="num text-right">{sent}</Td><Td className="num text-right">{failed}</Td><Td className="num text-right">{total ? `${Math.round((sent / total) * 100)}%` : "—"}</Td><Td>{row?.dailyLimit ?? "—"}</Td>
                    <Td className="text-right"><FormDialog trigger={<Button size="sm" variant="secondary">Configure</Button>} title={p.name} description="Enabling this provider disables other providers for the same channel." endpoint="/api/admin/notification-providers" method="PUT"
                      transform="admin.notificationProvider" transformArgs={{ key: p.key, fields: [...p.fields] }}
                      fields={[...p.fields.map((f) => ({ name: f, label: f, type: /token|secret|url|key/i.test(f) ? "password" as const : "text" as const, placeholder: creds[f] ? "•••• saved — leave empty to keep" : undefined })), { name: "dailyLimit", label: "Daily limit", type: "number", defaultValue: row?.dailyLimit }, { name: "enabled", label: "Enabled", type: "checkbox", defaultValue: row?.enabled }]} /></Td>
                  </tr>
                );
              })}
              <tr><Td className="font-medium">Push notifications</Td><Td>push</Td><Td><span className="text-sm text-ink-3">Not configured</span></Td><Td colSpan={5} className="text-sm text-ink-3">No push provider is integrated yet; members get in-app notifications instead.</Td></tr>
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-ink-3">Email also works in development via EMAIL_TRANSPORT=console (logged, never delivered) — refused in production.</p>
        </CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Templates" description="Draft → Review → Published → Archived. Publishing a version archives the previous one. Use {{variables}} like {{firstName}}, {{gymName}}." />
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-1">{Object.entries(TEMPLATE_KEYS).map(([k, l]) => <a key={k} href={`/super-admin/notifications?key=${k}`} className={`rounded-lg px-2.5 py-1 text-sm ${selected === k ? "bg-ink text-mist" : "text-ink-2 hover:bg-surface-2"}`}>{l}</a>)}</div>
          <FormDialog trigger={<Button size="sm">New version</Button>} title={`New ${TEMPLATE_KEYS[selected as keyof typeof TEMPLATE_KEYS]} version`} endpoint="/api/admin/templates" transform="admin.template" transformArgs={{ key: selected }} fields={[
            { name: "channel", label: "Channel", type: "select", required: true, options: ["IN_APP", "SMS", "EMAIL", "WHATSAPP"].map((c) => ({ value: c, label: c.toLowerCase() })) },
            { name: "subject", label: "Subject / title" }, { name: "body", label: "Body", type: "textarea", required: true },
          ]} />
          <ul className="mt-4 space-y-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-2xl bg-mist p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.channel.toLowerCase()} · v{t.version}</span><StatusPill status={t.status} />
                  <span className="ml-auto flex gap-1">{NEXT[t.status]!.map((n) => <ActionButton key={n} size="sm" variant={n === "PUBLISHED" ? "primary" : "ghost"} method="PATCH" endpoint={`/api/admin/templates/${t.id}`} body={{ status: n }} success={`Moved to ${n.toLowerCase()}`}>{n === "REVIEW" ? "Send for review" : n === "PUBLISHED" ? "Publish" : n === "DRAFT" ? "Back to draft" : "Archive"}</ActionButton>)}</span>
                </div>
                {t.subject && <p className="mt-2 text-sm font-medium">{t.subject}</p>}
                <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{t.body}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
