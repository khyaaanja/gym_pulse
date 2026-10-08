import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { FLAG_DEFS, FLAG_KEYS } from "@/lib/flags";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { FlagToggle } from "@/components/admin/flag-toggle";

export default async function Flags() {
  await requireAdmin("flags.manage");
  const [rows, plans] = await Promise.all([prisma.featureFlag.findMany(), prisma.saasPlan.findMany({ orderBy: { sortOrder: "asc" } })]);
  const find = (k: string, scope: string, id = "") => rows.find((r) => r.key === k && r.scope === scope && r.scopeId === id);
  return (
    <>
      <PageHeader title="Feature flags" description="Resolution order: gym override → plan → global → built-in default. Gym overrides are set on each gym's page." />
      <Card><CardBody>
        <Table>
          <thead><tr><Th>Feature</Th><Th>Global</Th>{plans.map((p) => <Th key={p.id}>{p.name}</Th>)}<Th className="text-right">Gym overrides</Th></tr></thead>
          <tbody>{FLAG_KEYS.map((k) => {
            const g = find(k, "GLOBAL");
            const globalValue = g ? g.enabled : FLAG_DEFS[k].default;
            return (
              <tr key={k}>
                <Td className="font-medium">{FLAG_DEFS[k].label}<span className="block text-xs text-ink-3">{k} · default {FLAG_DEFS[k].default ? "on" : "off"}</span></Td>
                <Td><FlagToggle flag={k} scope="GLOBAL" scopeId="" value={globalValue} overridden={!!g} /></Td>
                {plans.map((p) => { const r = find(k, "PLAN", p.id); return <Td key={p.id}><FlagToggle flag={k} scope="PLAN" scopeId={p.id} value={r ? r.enabled : globalValue} overridden={!!r} /></Td>; })}
                <Td className="num text-right">{rows.filter((r) => r.key === k && r.scope === "GYM").length}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
