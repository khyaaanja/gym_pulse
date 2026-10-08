import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { daysAgo, now } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export default async function Security() {
  const s = await requireAdmin("security.manage");
  const since = daysAgo(7);
  const [byType, events, ips, adminSessions, activeSessions, admins] = await Promise.all([
    prisma.securityEvent.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.securityEvent.groupBy({ by: ["ip"], where: { createdAt: { gte: since }, type: { in: ["LOGIN_FAILED", "ADMIN_LOGIN_FAILED", "MFA_FAILED", "ADMIN_MFA_FAILED", "WEBHOOK_SIGNATURE_INVALID"] } }, _count: true, orderBy: { _count: { ip: "desc" } }, take: 10 }),
    prisma.adminSession.findMany({ where: { revokedAt: null, expiresAt: { gt: now() } }, include: { admin: { select: { name: true, role: true } } }, orderBy: { lastSeenAt: "desc" } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now() } } }),
    prisma.platformAdmin.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const count = (t: string) => byType.filter((b) => b.type.includes(t)).reduce((a, b) => a + b._count, 0);
  const action = (label: string, act: string, target: string) => (
    <FormDialog trigger={<Button variant="secondary">{label}</Button>} title={label} endpoint="/api/admin/security" submitLabel={label} transform="admin.security" transformArgs={{ action: act, target }} fields={[{ name: "email", label: target === "user" ? "Gym user's email" : "Admin's email", type: "email", required: true }]} />
  );
  return (
    <>
      <PageHeader title="Security" description="Last 7 days of authentication and integrity events." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[["Failed logins", count("LOGIN_FAILED")], ["Throttled sign-ins", count("LOGIN_THROTTLED")], ["MFA failures", count("MFA_FAILED")], ["Privilege changes", count("PRIVILEGE_CHANGE")], ["Bad webhook signatures", count("WEBHOOK_SIGNATURE_INVALID")]].map(([l, v]) => (
          <Card key={String(l)}><CardBody><p className="text-sm text-ink-3">{l}</p><p className={`display num mt-1 text-3xl font-semibold ${Number(v) > 0 && l !== "Privilege changes" ? "text-risk" : ""}`}>{v}</p></CardBody></Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader title="Account actions" description={`${activeSessions} active member/staff sessions.`} />
        <CardBody className="flex flex-wrap gap-2">
          {action("Revoke user sessions", "revoke_sessions", "user")}
          {action("Disable user", "disable", "user")}
          {action("Re-enable user", "enable", "user")}
          {action("Force password reset", "force_password_reset", "user")}
          {action("Require MFA for user", "require_mfa", "user")}
          {action("Disable admin", "disable", "admin")}
        </CardBody>
      </Card>
      <div className="grid-cols-1 mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Admin sessions" />
          <CardBody><ul className="divide-y divide-line text-sm">{adminSessions.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 py-2"><span>{x.admin.name} <span className="text-ink-3">· {x.ip ?? "unknown IP"} · seen {x.lastSeenAt.toLocaleTimeString("en-GB")}{x.adminId === s.adminId ? " · you" : ""}</span></span>{x.adminId !== s.adminId && <ActionButton size="sm" variant="ghost" endpoint="/api/admin/security" body={{ action: "revoke_sessions", target: "admin_session", id: x.id }}>Revoke</ActionButton>}</li>)}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Noisy IP addresses" description="Failed sign-ins and bad signatures." />
          <CardBody><ul className="divide-y divide-line text-sm">{ips.map((i) => <li key={i.ip ?? "none"} className="flex justify-between py-2"><span className="num">{i.ip ?? "unknown"}</span><Badge tone={i._count >= 10 ? "risk" : "neutral"}>{i._count}</Badge></li>)}{ips.length === 0 && <li className="text-ink-3">Nothing suspicious.</li>}</ul></CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Platform admins" />
        <CardBody><ul className="divide-y divide-line text-sm">{admins.map((a) => <li key={a.id} className="flex justify-between py-2"><span>{a.name} <span className="text-ink-3">· {a.email} · {a.role.replace("_", " ").toLowerCase()}</span></span><span className="flex gap-2">{a.mfaEnabled ? <Badge tone="ok">2-step on</Badge> : <Badge tone="warn">2-step off</Badge>}{a.disabledAt && <Badge tone="lost">disabled</Badge>}</span></li>)}</ul></CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Recent events" />
        <CardBody>
          <Table><thead><tr><Th>When</Th><Th>Event</Th><Th>Who</Th><Th>IP</Th></tr></thead>
            <tbody>{events.map((e) => <tr key={e.id}><Td className="whitespace-nowrap">{e.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</Td><Td className="font-medium">{e.type.replace(/_/g, " ").toLowerCase()}</Td><Td className="text-ink-2">{e.email ?? e.userId ?? e.adminId ?? "—"}</Td><Td className="num text-ink-3">{e.ip ?? "—"}</Td></tr>)}</tbody></Table>
        </CardBody>
      </Card>
    </>
  );
}
