import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/page-auth";
import { adminCan } from "@/lib/rbac";
import { prisma } from "@/db/client";
import { resolveFlags, FLAG_DEFS, FLAG_KEYS } from "@/lib/flags";
import { usage, type LimitKind } from "@/lib/limits";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FlagToggle } from "@/components/admin/flag-toggle";

export default async function GymDetail({ params }: PageProps<"/super-admin/gyms/[id]">) {
  const s = await requireAdmin("gyms.view");
  const { id } = await params;
  const gym = await prisma.gym.findUnique({ where: { id }, include: { plan: true, subscription: { include: { invoices: { orderBy: { periodStart: "desc" }, take: 6 } } }, supportAdmin: true, staff: { include: { user: { select: { name: true, email: true, lastLoginAt: true } } } } } });
  if (!gym) notFound();
  const manage = adminCan(s.admin.role, "gyms.manage");
  const [plans, admins, flags, overrides, audits, ...used] = await Promise.all([
    prisma.saasPlan.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.platformAdmin.findMany({ where: { role: { in: ["SUPER_ADMIN", "SUPPORT_ADMIN"] }, disabledAt: null }, select: { id: true, name: true } }),
    resolveFlags(gym),
    prisma.featureFlag.findMany({ where: { scope: "GYM", scopeId: gym.id } }),
    prisma.auditLog.findMany({ where: { gymId: gym.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    ...(["members", "staff", "importsPerMonth", "predictionsPerMonth", "notificationsPerMonth"] as LimitKind[]).map((k) => usage(gym.id, k, gym.timezone)),
  ]);
  const lim = gym.plan;
  const rows: [string, number, number | null | undefined][] = [["Members", used[0]!, lim?.memberLimit], ["Staff", used[1]!, lim?.staffLimit], ["Imports this month", used[2]!, lim?.importsPerMonth], ["Estimates this month", used[3]!, lim?.predictionsPerMonth], ["Messages this month", used[4]!, lim?.notificationsPerMonth]];
  const act = (action: string, label: string, variant: "danger" | "secondary" | "ok") => (
    <FormDialog trigger={<Button size="sm" variant={variant}>{label}</Button>} title={`${label} ${gym.name}`} description="The reason is saved in the audit log and visible to the gym owner." endpoint={`/api/admin/gyms/${gym.id}/actions`} submitLabel={label} transform="admin.gymAction" transformArgs={{ action }} fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]} />
  );
  return (
    <>
      <PageHeader title={gym.name} description={`${[gym.address, gym.city, gym.province].filter(Boolean).join(", ") || "No address"} · ${gym.timezone} · created ${gym.createdAt.toLocaleDateString("en-GB")}`} actions={manage ? (
        <>
          {gym.status !== "SUSPENDED" && gym.status !== "ARCHIVED" && act("suspend", "Suspend", "danger")}
          {gym.status === "SUSPENDED" && act("reactivate", "Reactivate", "ok")}
          {gym.status !== "ARCHIVED" && act("archive", "Archive", "secondary")}
          <FormDialog trigger={<Button size="sm" variant="secondary">Edit</Button>} title="Edit gym" endpoint={`/api/admin/gyms/${gym.id}`} method="PATCH" fields={[
            { name: "name", label: "Name", required: true, defaultValue: gym.name }, { name: "phone", label: "Phone", defaultValue: gym.phone }, { name: "email", label: "Email", type: "email", defaultValue: gym.email },
            { name: "address", label: "Address", defaultValue: gym.address }, { name: "city", label: "City", defaultValue: gym.city }, { name: "province", label: "Province", defaultValue: gym.province },
            { name: "timezone", label: "Timezone", required: true, defaultValue: gym.timezone },
            { name: "planId", label: "Plan", type: "select", required: true, defaultValue: gym.planId, options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatMoney(p.pricePaisa)}` })) },
            { name: "supportAdminId", label: "Support admin", type: "select", defaultValue: gym.supportAdminId, options: admins.map((a) => ({ value: a.id, label: a.name })) },
          ]} />
        </>
      ) : undefined} />
      <div className="mb-4 flex flex-wrap gap-2"><StatusPill status={gym.status} />{gym.suspendedReason && <Badge tone="risk">{gym.suspendedReason}</Badge>}<Badge>{gym.plan?.name ?? "No plan"}</Badge>{gym.supportAdmin && <Badge tone="brand">Support: {gym.supportAdmin.name}</Badge>}</div>
      <div className="grid-cols-1 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Usage vs plan limits" />
          <CardBody><dl className="divide-y divide-line text-sm">{rows.map(([l, u, max]) => <div key={l} className="flex justify-between py-2.5"><dt className="text-ink-3">{l}</dt><dd className={`num font-medium ${max && u >= max ? "text-risk" : ""}`}>{u} / {max ?? "∞"}</dd></div>)}</dl></CardBody>
        </Card>
        <Card>
          <CardHeader title="Billing" description={gym.subscription ? `${gym.subscription.status.toLowerCase()} · period ends ${gym.subscription.currentPeriodEnd.toLocaleDateString("en-GB")}` : "No subscription"} />
          <CardBody><ul className="divide-y divide-line text-sm">{gym.subscription?.invoices.map((i) => <li key={i.id} className="flex justify-between py-2.5"><span className="num">{i.number}</span><span className="flex gap-2"><StatusPill status={i.status === "DUE" ? "PENDING" : i.status} /><span className="num">{formatMoney(i.amountPaisa)}</span></span></li>)}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Features for this gym" description="Gym overrides beat plan and global settings. Checked server-side on every request." />
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {FLAG_KEYS.map((k) => {
                const o = overrides.find((x) => x.key === k);
                return <li key={k} className="flex items-center justify-between gap-2 py-2"><span>{FLAG_DEFS[k].label}{o && <Badge tone="brand" className="ml-2">Override</Badge>}</span><FlagToggle flag={k} scope="GYM" scopeId={gym.id} value={flags[k]} overridden={!!o} disabled={!adminCan(s.admin.role, "flags.manage")} /></li>;
              })}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Staff" />
          <CardBody><ul className="divide-y divide-line text-sm">{gym.staff.map((st) => <li key={st.id} className="flex justify-between py-2.5"><span>{st.user.name} <span className="text-ink-3">· {st.role.toLowerCase()} · {st.user.email}</span></span><span className="text-ink-3">{st.user.lastLoginAt?.toLocaleDateString("en-GB") ?? "never"}</span></li>)}</ul></CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Audit log" />
        <CardBody><ul className="divide-y divide-line text-sm">{audits.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span><span className="font-medium">{a.action}</span> <span className="text-ink-3">· {a.actorName ?? a.actorType.toLowerCase()}</span></span><span className="whitespace-nowrap text-ink-3">{a.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span></li>)}</ul></CardBody>
      </Card>
    </>
  );
}
