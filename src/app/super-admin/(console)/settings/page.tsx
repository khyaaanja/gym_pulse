import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

export default async function Settings() {
  const s = await requireAdmin("settings.manage");
  const [settings, admins] = await Promise.all([prisma.platformSetting.findMany({ orderBy: { key: "asc" } }), prisma.platformAdmin.findMany({ orderBy: { createdAt: "asc" } })]);
  return (
    <>
      <PageHeader title="Settings" description="Platform-wide values (pricing shown on the website, ROI example, trial length…) and admin accounts." />
      <Card>
        <CardHeader title="Platform settings" />
        <CardBody>
          <ul className="divide-y divide-line">
            {settings.map((x) => (
              <li key={x.key} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1"><p className="font-medium">{x.key}</p>{x.description && <p className="text-sm text-ink-3">{x.description}</p>}<pre className="mt-1 whitespace-pre-wrap break-all text-xs text-ink-2">{JSON.stringify(x.value)}</pre></div>
                <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={x.key} description="Value as JSON (numbers, strings in quotes, objects)." endpoint="/api/admin/settings" method="PUT" transform="admin.platformSetting" transformArgs={{ key: x.key }} fields={[{ name: "value", label: "Value", type: "textarea", required: true, defaultValue: JSON.stringify(x.value, null, 2) }]} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Admins" description="New admins must change their password and set up two-step verification at first sign-in." action={
          <FormDialog trigger={<Button size="sm">Add admin</Button>} title="New platform admin" endpoint="/api/admin/admins" fields={[{ name: "name", label: "Name", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "role", label: "Role", type: "select", required: true, options: [{ value: "SUPPORT_ADMIN", label: "Support admin" }, { value: "FINANCE_ADMIN", label: "Finance admin" }, { value: "SUPER_ADMIN", label: "Super admin" }] }, { name: "temporaryPassword", label: "Temporary password", type: "password", required: true }]} />
        } />
        <CardBody>
          <ul className="divide-y divide-line text-sm">{admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>{a.name} <span className="text-ink-3">· {a.email}</span></span>
              {a.id === s.adminId ? <span className="text-ink-3">{a.role.replace("_", " ").toLowerCase()} (you)</span> : (
                <span className="flex gap-1">{["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"].filter((r) => r !== a.role).map((r) => <ActionButton key={r} size="sm" variant="ghost" method="PATCH" endpoint={`/api/admin/admins/${a.id}`} body={{ role: r }} confirm={`Change ${a.name} to ${r.replace("_", " ").toLowerCase()}? Their sessions will be signed out.`}>Make {r.split("_")[0]!.toLowerCase()}</ActionButton>)}</span>
              )}
            </li>
          ))}</ul>
        </CardBody>
      </Card>
    </>
  );
}
