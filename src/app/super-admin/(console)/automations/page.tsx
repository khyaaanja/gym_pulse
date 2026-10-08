import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { daysAgo } from "@/lib/time";
import { TEMPLATE_KEYS } from "@/services/notifications/templates";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldSpec } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

const TRIGGERS = ["MEMBER_INACTIVE", "MEMBERSHIP_EXPIRING", "MEMBERSHIP_EXPIRED", "PAYMENT_FAILED", "MILESTONE_REACHED", "MARKETPLACE_PURCHASE"];
const ACTIONS = ["NOTIFY_STAFF", "SEND_NOTIFICATION", "FLAG_AT_RISK", "AWARD_REWARD", "CREATE_BOOKING"];
const opt = (xs: string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, " ").toLowerCase() }));

export default async function Automations() {
  await requireAdmin("automations.manage");
  const [rules, runs, overrides] = await Promise.all([
    prisma.automationRule.findMany({ where: { gymId: null }, orderBy: [{ trigger: "asc" }, { priority: "desc" }] }),
    prisma.automationRun.groupBy({ by: ["ruleId"], _count: true, where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.automationRule.groupBy({ by: ["key"], where: { gymId: { not: null } }, _count: true }),
  ]);
  const fields = (r?: (typeof rules)[number]): FieldSpec[] => {
    const ac = (r?.actionConfig ?? {}) as { template?: string; channels?: string[] };
    const cond = (r?.conditions ?? {}) as { minDaysInactive?: number };
    return [
      ...(r ? [] : [
        { name: "key", label: "Key", required: true, placeholder: "inactive-20d-nudge" },
        { name: "trigger", label: "Trigger", type: "select" as const, required: true, options: opt(TRIGGERS) },
        { name: "action", label: "Action", type: "select" as const, required: true, options: opt(ACTIONS) },
        { name: "audience", label: "Audience", type: "select" as const, required: true, options: opt(["MEMBER", "STAFF", "OWNER"]) },
      ]),
      { name: "name", label: "Name", required: true, defaultValue: r?.name },
      { name: "minDaysInactive", label: "Condition: at least N days inactive (inactivity rules)", type: "number", defaultValue: cond.minDaysInactive },
      { name: "delayMinutes", label: "Delay (minutes)", type: "number", defaultValue: r?.delayMinutes ?? 0 },
      { name: "template", label: "Message template", type: "select", defaultValue: ac.template, options: Object.entries(TEMPLATE_KEYS).map(([k, l]) => ({ value: k, label: l })) },
      ...["IN_APP", "SMS", "EMAIL", "WHATSAPP"].map((c) => ({ name: `ch_${c}`, label: `Send via ${c.replace("_", "-").toLowerCase()}`, type: "checkbox" as const, defaultValue: (ac.channels ?? ["IN_APP"]).includes(c) })),
      { name: "priority", label: "Priority (higher runs first)", type: "number", defaultValue: r?.priority ?? 0 },
      { name: "enabled", label: "Enabled", type: "checkbox", defaultValue: r?.enabled ?? true },
    ];
  };
  return (
    <>
      <PageHeader title="Automations" description="Platform defaults. A gym rule with the same key overrides these. Each edit creates a new version; runs are de-duplicated per version." actions={<FormDialog trigger={<Button>New rule</Button>} title="New automation" endpoint="/api/admin/automations" fields={fields()} transform="admin.automation" />} />
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Rule</Th><Th>Trigger</Th><Th>Action</Th><Th>Delay</Th><Th className="text-right">Runs (30d)</Th><Th>Version</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium">{r.name}<span className="block text-xs text-ink-3">{r.key}{overrides.find((o) => o.key === r.key) ? ` · overridden by ${overrides.find((o) => o.key === r.key)!._count} gym(s)` : ""}</span></Td>
              <Td><Badge>{r.trigger.replace(/_/g, " ").toLowerCase()}</Badge></Td>
              <Td className="text-ink-2">{r.action.replace(/_/g, " ").toLowerCase()} → {r.audience.toLowerCase()}</Td>
              <Td>{r.delayMinutes ? `${r.delayMinutes} min` : "—"}</Td>
              <Td className="num text-right">{runs.find((x) => x.ruleId === r.id)?._count ?? 0}</Td>
              <Td className="num">v{r.version}</Td>
              <Td><StatusPill status={r.enabled ? "ACTIVE" : "ARCHIVED"} /></Td>
              <Td className="text-right"><div className="flex justify-end gap-1">
                <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={r.name} endpoint={`/api/admin/automations/${r.id}`} method="PATCH" fields={fields(r)} transform="admin.automation" transformArgs={{ edit: true }} />
                <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/automations/${r.id}`} body={{ enabled: !r.enabled }}>{r.enabled ? "Disable" : "Enable"}</ActionButton>
              </div></Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
