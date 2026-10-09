import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { gymSettings } from "@/config/gym-settings";
import { predictionConfigFor } from "@/config/prediction";
import { decryptJson } from "@/lib/crypto";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";
import { effectivePermissions, PERMISSIONS, PERMISSION_LABELS, OWNER_ONLY } from "@/lib/rbac";
import { usage, type LimitKind } from "@/lib/limits";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusPill, Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { ImageUpload } from "@/components/app/image-upload";
import { DeviceCreate, StaffInvite } from "@/components/app/settings-widgets";
import { effectiveRules } from "@/services/automation";
import { activeLocations } from "@/services/locations";
import { formatDate } from "@/lib/time";

export const metadata = { title: "Settings" };

const TABS = [
  { k: "profile", l: "Gym profile", p: "settings.manage" },
  { k: "plans", l: "Membership plans", p: "plans.manage" },
  { k: "rules", l: "Attendance & reminders", p: "settings.manage" },
  { k: "payments", l: "Payments", p: "settings.manage" },
  { k: "engagement", l: "Challenges & rewards", p: "settings.manage" },
  { k: "automations", l: "Automations", p: "settings.manage" },
  { k: "staff", l: "Staff & permissions", p: "staff.manage" },
  { k: "locations", l: "Branches", p: "settings.manage" },
  { k: "devices", l: "Check-in devices", p: "settings.manage" },
  { k: "billing", l: "GymPulse plan", p: "billing.manage" },
  { k: "audit", l: "Audit log", p: "audit.view" },
  { k: "support", l: "Support", p: null },
] as const;

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-4 py-2.5 text-sm"><dt className="text-ink-3">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;

export default async function Settings({ searchParams }: PageProps<"/app/settings">) {
  const ctx = await requireStaff();
  const allowed = TABS.filter((t) => !t.p || ctx.can(t.p));
  if (allowed.length <= 1) redirect("/app/forbidden");
  const sp = await searchParams;
  const tab = allowed.find((t) => t.k === sp.tab)?.k ?? allowed[0]!.k;
  const g = ctx.gym;
  const s = gymSettings(g.settings);
  const sym = g.currencySymbol;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid-cols-1 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="relative -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Settings sections">
          {allowed.map((t) => <Link key={t.k} href={`/app/settings?tab=${t.k}`} aria-current={tab === t.k ? "page" : undefined} className={`shrink-0 rounded-xl px-3 py-2 text-sm ${tab === t.k ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-surface-2"}`}>{t.l}</Link>)}
        </nav>
        <div className="min-w-0 space-y-4">
          {tab === "profile" && <ProfileTab />}
          {tab === "plans" && <PlansTab />}
          {tab === "rules" && <RulesTab />}
          {tab === "payments" && <PaymentsTab />}
          {tab === "engagement" && <EngagementTab />}
          {tab === "automations" && <AutomationsTab />}
          {tab === "staff" && <StaffTab />}
          {tab === "locations" && <LocationsTab />}
          {tab === "devices" && <DevicesTab />}
          {tab === "billing" && <BillingTab />}
          {tab === "audit" && <AuditTab />}
          {tab === "support" && <SupportTab />}
        </div>
      </div>
    </>
  );

  async function ProfileTab() {
    return (
      <Card>
        <CardHeader title="Gym profile" action={<FormDialog trigger={<Button size="sm" variant="secondary">Edit</Button>} title="Gym profile" endpoint="/api/gym/settings" method="PATCH" transform="gym.profile" fields={[
          { name: "name", label: "Gym name", required: true, defaultValue: g.name },
          { name: "phone", label: "Phone", defaultValue: g.phone },
          { name: "email", label: "Email", type: "email", defaultValue: g.email },
          { name: "address", label: "Address", defaultValue: g.address },
          { name: "city", label: "City", defaultValue: g.city },
          { name: "province", label: "Province", type: "select", defaultValue: g.province, options: ["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"].map((p) => ({ value: p, label: p })) },
          { name: "currencySymbol", label: "Currency symbol", type: "select", required: true, defaultValue: g.currencySymbol, options: [{ value: "Rs.", label: "Rs." }, { value: "रु", label: "रु" }, { value: "NPR", label: "NPR" }, { value: "₹", label: "₹" }] },
        ]} />} />
        <CardBody>
          <div className="mb-4 flex items-center gap-3">
            {g.logoFileId ? <img src={`/api/files/${g.logoFileId}`} alt="Gym logo" className="size-14 rounded-2xl object-cover ring-1 ring-line" /> : <div className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-xs text-ink-3">No logo</div>}
            <ImageUpload kind="LOGO" />
          </div>
          <dl className="divide-y divide-line">
            <Row k="Name" v={g.name} /><Row k="Phone" v={g.phone ?? "—"} /><Row k="Email" v={g.email ?? "—"} /><Row k="Address" v={[g.address, g.city, g.province].filter(Boolean).join(", ") || "—"} /><Row k="Timezone" v={g.timezone} /><Row k="Currency" v={`${g.currency} (${sym})`} />
          </dl>
        </CardBody>
      </Card>
    );
  }

  async function PlansTab() {
    const plans = await ctx.db.membershipPlan.findMany({ include: { _count: { select: { memberships: { where: { status: "ACTIVE" } } } } }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }] });
    const fields = (p?: (typeof plans)[number]) => [
      { name: "name", label: "Name", required: true, defaultValue: p?.name },
      { name: "description", label: "Short description", defaultValue: p?.description },
      { name: "durationDays", label: "Length (days)", type: "number" as const, required: true, defaultValue: p?.durationDays ?? 30 },
      { name: "priceRupees", label: "Price (NPR)", type: "number" as const, required: true, defaultValue: p ? p.pricePaisa / 100 : undefined, hint: p ? "Changes apply to new purchases and renewals, not current memberships." : undefined },
      { name: "sortOrder", label: "Order", type: "number" as const, defaultValue: p?.sortOrder ?? 0 },
      { name: "active", label: "Available for sale", type: "checkbox" as const, defaultValue: p?.active ?? true },
    ];
    return (
      <Card>
        <CardHeader title="Membership plans" action={<FormDialog trigger={<Button size="sm">Add plan</Button>} title="New plan" endpoint="/api/gym/plans" fields={fields()} />} />
        <CardBody>
          <Table>
            <thead><tr><Th>Plan</Th><Th>Length</Th><Th className="text-right">Price</Th><Th className="text-right">Active members</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}{p.isImported && <Badge className="ml-2">Imported</Badge>}</Td>
                  <Td>{p.durationDays} days</Td>
                  <Td className="num text-right">{formatMoney(p.pricePaisa, sym)}</Td>
                  <Td className="num text-right">{p._count.memberships}</Td>
                  <Td><StatusPill status={p.active ? "ACTIVE" : "ARCHIVED"} /></Td>
                  <Td className="text-right"><FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={p.name} endpoint={`/api/gym/plans/${p.id}`} method="PATCH" fields={fields(p)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    );
  }

  async function RulesTab() {
    const cfg = await predictionConfigFor(g.id);
    return (
      <>
        <Card>
          <CardHeader title="Attendance & retention" action={<FormDialog trigger={<Button size="sm" variant="secondary">Edit</Button>} title="Attendance & retention" endpoint="/api/gym/settings" method="PATCH"
            transform="gym.attendance" transformArgs={{ attendance: s.attendance }}
            fields={[
              { name: "inactivityThresholdDays", label: "Flag members at risk after (days without a visit)", type: "number", required: true, defaultValue: cfg.inactivityThresholdDays, hint: "Between 5 and 60." },
              { name: "protectedRevenueMonths", label: "Months of fees counted as protected when a member is recovered", type: "number", required: true, defaultValue: cfg.protectedRevenueMonths, hint: "An assumption for the estimate — shown wherever protected revenue appears." },
              { name: "allowSelfQr", label: "Members can check themselves in by scanning the kiosk QR", type: "checkbox", defaultValue: s.attendance.allowSelfQr },
              { name: "requireActiveMembership", label: "Require an active membership to check in", type: "checkbox", defaultValue: s.attendance.requireActiveMembership },
            ]} />} />
          <CardBody><dl className="divide-y divide-line">
            <Row k="At-risk after" v={`${cfg.inactivityThresholdDays} days without a visit`} />
            <Row k="Protected revenue assumption" v={`${cfg.protectedRevenueMonths} months`} />
            <Row k="Self check-in (kiosk QR)" v={s.attendance.allowSelfQr ? "On" : "Off"} />
            <Row k="Active membership required" v={s.attendance.requireActiveMembership ? "Yes" : "No"} />
          </dl></CardBody>
        </Card>
        <Card>
          <CardHeader title="Renewal reminders & imports" action={<FormDialog trigger={<Button size="sm" variant="secondary">Edit</Button>} title="Renewal reminders & imports" endpoint="/api/gym/settings" method="PATCH"
            transform="gym.reminders"
            fields={[
              { name: "offsets", label: "Send reminders (days before expiry; 0 = on the day, negative = after)", required: true, defaultValue: s.renewal.reminderOffsetsDays.join(", ") },
              { name: "grace", label: "Grace period after expiry (days)", type: "number", required: true, defaultValue: s.renewal.gracePeriodDays },
              { name: "sms", label: "Send reminders by SMS", type: "checkbox", defaultValue: s.renewal.channels.includes("SMS") },
              { name: "email", label: "Send reminders by email", type: "checkbox", defaultValue: s.renewal.channels.includes("EMAIL") },
              { name: "whatsapp", label: "Send reminders by WhatsApp", type: "checkbox", defaultValue: s.renewal.channels.includes("WHATSAPP") },
              { name: "retention", label: "Delete uploaded record files after (days)", type: "number", required: true, defaultValue: s.imports.rawFileRetentionDays },
              { name: "dateOrder", label: "Dates in your sheets are written as", type: "select", required: true, defaultValue: s.imports.dateOrder, options: [{ value: "DMY", label: "Day/Month/Year (31/12/2026)" }, { value: "MDY", label: "Month/Day/Year (12/31/2026)" }, { value: "YMD", label: "Year-Month-Day" }] },
              { name: "suggest", label: "Show members one relevant marketplace suggestion", type: "checkbox", defaultValue: s.marketplace.contextualSuggestions },
            ]} />} />
          <CardBody><dl className="divide-y divide-line">
            <Row k="Reminders" v={s.renewal.reminderOffsetsDays.map((d) => (d > 0 ? `${d}d before` : d === 0 ? "on the day" : `${-d}d after`)).join(", ")} />
            <Row k="Channels" v={s.renewal.channels.map((c) => c.replace("_", "-").toLowerCase()).join(", ")} />
            <Row k="Grace period" v={`${s.renewal.gracePeriodDays} days`} />
            <Row k="Uploaded files kept for" v={`${s.imports.rawFileRetentionDays} days`} />
            <Row k="Date format" v={s.imports.dateOrder} />
          </dl></CardBody>
        </Card>
      </>
    );
  }

  async function PaymentsTab() {
    const rows = await prisma.paymentProviderConfig.findMany({ where: { OR: [{ gymId: null }, { gymId: g.id }] } });
    const platform = rows.filter((r) => r.gymId === null && r.enabled && r.providerKey !== "sandbox");
    return (
      <Card>
        <CardHeader title="Online payments" description="Members pay into your own eSewa or Khalti merchant account. Keys are encrypted and can't be viewed after saving." />
        <CardBody className="space-y-3">
          {platform.length === 0 && <p className="text-sm text-ink-3">No payment providers are available yet.</p>}
          {platform.map((p) => {
            const mine = rows.find((r) => r.gymId === g.id && r.providerKey === p.providerKey);
            const creds = decryptJson<Record<string, string>>(mine?.credentialsEnc) ?? {};
            const fields = PAYMENT_ADAPTERS[p.providerKey]?.credentialFields ?? [];
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-mist p-4">
                <div className="flex-1">
                  <p className="font-semibold">{p.displayName}</p>
                  <p className="text-sm text-ink-3">{mine?.enabled ? `Connected · ${mine.environment === "LIVE" ? "live" : "test mode"}` : "Not configured"} · {fields.map((f) => `${f} ${creds[f] ? "✓" : "missing"}`).join(" · ")}</p>
                </div>
                <FormDialog trigger={<Button size="sm" variant={mine?.enabled ? "secondary" : "primary"}>{mine?.enabled ? "Update" : "Connect payment provider"}</Button>} title={`Connect ${p.displayName}`} endpoint="/api/gym/payment-providers" method="PUT"
                  transform="gym.paymentProvider" transformArgs={{ providerKey: p.providerKey, fields }}
                  fields={[
                    ...fields.map((f) => ({ name: f, label: f === "productCode" ? "Merchant / product code" : "Secret key", type: f === "productCode" ? "text" as const : "password" as const, placeholder: creds[f] ? "•••••••• (saved — leave empty to keep)" : undefined })),
                    { name: "environment", label: "Mode", type: "select", required: true, defaultValue: mine?.environment ?? "SANDBOX", options: [{ value: "SANDBOX", label: "Test (sandbox)" }, { value: "LIVE", label: "Live" }] },
                    { name: "enabled", label: "Accept payments with this provider", type: "checkbox", defaultValue: mine?.enabled ?? true },
                  ]} />
              </div>
            );
          })}
          <p className="text-xs text-ink-3">Return URL to register with the provider: <code>{process.env.APP_URL}/api/payments/return/&lt;provider&gt;</code>. A payment only counts once the provider confirms it to our server.</p>
        </CardBody>
      </Card>
    );
  }

  async function EngagementTab() {
    const [challenges, milestones, rewards] = await Promise.all([
      ctx.db.challenge.findMany({ include: { reward: true }, orderBy: { createdAt: "asc" } }),
      ctx.db.milestone.findMany({ include: { reward: true, _count: { select: { awarded: true } } }, orderBy: [{ kind: "asc" }, { threshold: "asc" }] }),
      ctx.db.reward.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const rewardOpts = rewards.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }));
    const rest = s.engagement.streakRestDays;
    const kinds = [{ value: "VISITS_IN_MONTH", label: "Visits in a month" }, { value: "STREAK_DAYS", label: "Streak length" }, { value: "WEEKEND_VISITS", label: "Saturday visits in a month" }, { value: "EARLY_BIRD", label: "Early check-ins in a month" }];
    const rewardKinds = [{ value: "BADGE", label: "Badge" }, { value: "DISCOUNT", label: "Renewal discount" }, { value: "FREE_SESSION", label: "Free session" }, { value: "MERCHANDISE", label: "Merchandise" }];
    return (
      <>
        <Card>
          <CardHeader title="Streak rules" description="Applies to every member's streak from their next check-in." action={<FormDialog trigger={<Button size="sm" variant="secondary">Edit</Button>} title="Streak rules" endpoint="/api/gym/settings" method="PATCH" transform="gym.engagementRules" fields={[
            { name: "streakRestDays", label: "Rest days allowed between visits", type: "select", required: true, defaultValue: String(rest), options: [{ value: "0", label: "None — visits on consecutive days" }, { value: "1", label: "1 rest day (recommended)" }, { value: "2", label: "2 rest days" }, { value: "3", label: "3 rest days" }] },
          ]} />} />
          <CardBody><dl className="divide-y divide-line"><Row k="A streak continues when" v={rest === 0 ? "the member visits every day" : `the member rests no more than ${rest} day${rest === 1 ? "" : "s"} in a row`} /></dl></CardBody>
        </Card>
        <Card>
          <CardHeader title="Challenges" action={<FormDialog trigger={<Button size="sm">Add challenge</Button>} title="New challenge" endpoint="/api/gym/engagement" transform="gym.challenge" fields={[
            { name: "name", label: "Name", required: true, placeholder: "20 visits in Dashain" },
            { name: "description", label: "Description" },
            { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "VISITS_IN_MONTH", label: "Visits in a month" }, { value: "STREAK_DAYS", label: "Streak length" }, { value: "WEEKEND_VISITS", label: "Saturday visits in a month" }, { value: "EARLY_BIRD", label: "Early check-ins in a month" }] },
            { name: "target", label: "Target", type: "number", required: true },
            { name: "beforeHour", label: "Early bird: before hour (24h)", type: "number", defaultValue: 7 },
            { name: "rewardId", label: "Reward", type: "select", options: rewardOpts },
          ]} />} />
          <CardBody>
            <ul className="divide-y divide-line text-sm">{challenges.map((c) => <li key={c.id} className="flex items-center justify-between py-2.5"><span><span className="font-medium">{c.name}</span> <span className="text-ink-3">· target {c.target}{c.reward ? ` · ${c.reward.name}` : ""}</span></span><span className="flex shrink-0 items-center gap-1">{!c.active && <Badge>Paused</Badge>}<FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={c.name} endpoint="/api/gym/engagement" transform="gym.challenge" transformArgs={{ id: c.id, active: c.active }} fields={[
              { name: "name", label: "Name", required: true, defaultValue: c.name }, { name: "description", label: "Description", defaultValue: c.description },
              { name: "kind", label: "Type", type: "select", required: true, defaultValue: c.kind, options: kinds }, { name: "target", label: "Target", type: "number", required: true, defaultValue: c.target },
              { name: "beforeHour", label: "Early bird: before hour (24h)", type: "number", defaultValue: ((c.config ?? {}) as { beforeHour?: number }).beforeHour ?? 7 },
              { name: "rewardId", label: "Reward", type: "select", defaultValue: c.rewardId, options: rewardOpts },
            ]} /><ActionButton size="sm" variant="ghost" endpoint="/api/gym/engagement" body={{ type: "challenge", id: c.id, name: c.name, description: c.description, kind: c.kind, target: c.target, rewardId: c.rewardId, active: !c.active, ...(c.kind === "EARLY_BIRD" ? { beforeHour: ((c.config ?? {}) as { beforeHour?: number }).beforeHour ?? 7 } : {}) }}>{c.active ? "Pause" : "Resume"}</ActionButton></span></li>)}</ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Milestones" action={<FormDialog trigger={<Button size="sm" variant="secondary">Add milestone</Button>} title="New milestone" endpoint="/api/gym/engagement" transform="gym.milestone" fields={[
            { name: "name", label: "Name", required: true }, { name: "tier", label: "Tier", required: true, placeholder: "Gold" },
            { name: "kind", label: "Based on", type: "select", required: true, options: [{ value: "STREAK", label: "Streak length" }, { value: "TOTAL_VISITS", label: "Total visits" }] },
            { name: "threshold", label: "Threshold", type: "number", required: true }, { name: "rewardId", label: "Reward", type: "select", options: rewardOpts },
          ]} />} />
          <CardBody><ul className="divide-y divide-line text-sm">{milestones.map((m) => <li key={m.id} className="flex items-center justify-between gap-3 py-2.5"><span><span className="font-medium">{m.tier}</span> <span className="text-ink-3">· {m.kind === "STREAK" ? `${m.threshold}-day streak` : `${m.threshold} visits`}{m.reward ? ` · ${m.reward.name}` : ""}</span></span><span className="flex shrink-0 items-center gap-1"><span className="num mr-2 text-ink-3">{m._count.awarded} awarded</span>{!m.active && <Badge>Paused</Badge>}<FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={m.name} endpoint="/api/gym/engagement" transform="gym.milestone" transformArgs={{ id: m.id, active: m.active }} fields={[
              { name: "name", label: "Name", required: true, defaultValue: m.name }, { name: "tier", label: "Tier", required: true, defaultValue: m.tier },
              { name: "kind", label: "Based on", type: "select", required: true, defaultValue: m.kind, options: [{ value: "STREAK", label: "Streak length" }, { value: "TOTAL_VISITS", label: "Total visits" }] },
              { name: "threshold", label: "Threshold", type: "number", required: true, defaultValue: m.threshold }, { name: "rewardId", label: "Reward", type: "select", defaultValue: m.rewardId, options: rewardOpts },
            ]} /><ActionButton size="sm" variant="ghost" endpoint="/api/gym/engagement" body={{ type: "milestone", id: m.id, name: m.name, tier: m.tier, kind: m.kind, threshold: m.threshold, rewardId: m.rewardId, active: !m.active }}>{m.active ? "Pause" : "Resume"}</ActionButton></span></li>)}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Rewards" action={<FormDialog trigger={<Button size="sm" variant="secondary">Add reward</Button>} title="New reward" endpoint="/api/gym/engagement" transform="gym.reward" fields={[
            { name: "name", label: "Name", required: true }, { name: "description", label: "Description" },
            { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "BADGE", label: "Badge" }, { value: "DISCOUNT", label: "Renewal discount" }, { value: "FREE_SESSION", label: "Free session" }, { value: "MERCHANDISE", label: "Merchandise" }] },
            { name: "value", label: "Value (discount in basis points, e.g. 1000 = 10%; sessions count)", type: "number" },
          ]} />} />
          <CardBody><ul className="divide-y divide-line text-sm">{rewards.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2.5"><span><span className="font-medium">{r.name}</span> <span className="text-ink-3">· {r.kind.replace("_", " ").toLowerCase()}{r.kind === "DISCOUNT" ? ` · ${r.value / 100}% off` : r.kind === "FREE_SESSION" ? ` · ${r.value} session${r.value === 1 ? "" : "s"}` : ""}</span></span><span className="flex shrink-0 items-center gap-1">{!r.active && <Badge>Retired</Badge>}<FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={r.name} endpoint="/api/gym/engagement" transform="gym.reward" transformArgs={{ id: r.id, active: r.active }} fields={[
              { name: "name", label: "Name", required: true, defaultValue: r.name }, { name: "description", label: "Description", defaultValue: r.description },
              { name: "kind", label: "Type", type: "select", required: true, defaultValue: r.kind, options: rewardKinds },
              { name: "value", label: "Value (discount in basis points, e.g. 1000 = 10%; sessions count)", type: "number", defaultValue: r.value },
            ]} /><ActionButton size="sm" variant="ghost" endpoint="/api/gym/engagement" body={{ type: "reward", id: r.id, name: r.name, description: r.description, kind: r.kind, value: r.value, active: !r.active }}>{r.active ? "Retire" : "Restore"}</ActionButton></span></li>)}</ul></CardBody>
        </Card>
      </>
    );
  }

  async function AutomationsTab() {
    if (!ctx.flags.automation) return <Card><CardBody><p className="text-sm text-ink-3">Automations aren&apos;t included in your GymPulse plan. See the GymPulse plan tab to upgrade.</p></CardBody></Card>;
    const rules = await effectiveRules(g.id);
    const label = (x: string) => x.replace(/_/g, " ").toLowerCase();
    const available = ["IN_APP", "EMAIL", ...(ctx.flags.sms ? ["SMS"] : []), ...(ctx.flags.whatsapp ? ["WHATSAPP"] : [])];
    return (
      <Card>
        <CardHeader title="Automations" description="What GymPulse does on its own when members go quiet, memberships expire or payments fail. Changes apply to future runs — nothing is re-sent." />
        <CardBody>
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}{r.overridden && <Badge tone="brand" className="ml-2">Customised</Badge>}</p>
                  <p className="text-sm text-ink-3">When {label(r.trigger)}{r.conditions.minDaysInactive ? ` for ${r.conditions.minDaysInactive}+ days` : ""} → {label(r.action)} ({label(r.audience)}){r.delayMinutes ? ` after ${r.delayMinutes >= 60 ? `${Math.round(r.delayMinutes / 60)} h` : `${r.delayMinutes} min`}` : ""} · {r.channels.map(label).join(", ")}</p>
                </div>
                <StatusPill status={r.enabled && r.platformEnabled ? "ACTIVE" : "ARCHIVED"} />
                <div className="flex gap-1">
                  <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={r.name} endpoint="/api/gym/automations" method="PUT" transform="gym.automation" transformArgs={{ key: r.key }} fields={[
                    { name: "enabled", label: "Run this automation for my gym", type: "checkbox", defaultValue: r.enabled },
                    { name: "delayHours", label: "Wait before acting (hours)", type: "number", defaultValue: Math.round(r.delayMinutes / 60), hint: "0 = straight away. Up to 336 hours (14 days)." },
                    ...(r.trigger === "MEMBER_INACTIVE" ? [{ name: "minDaysInactive", label: "Only when inactive for at least (days)", type: "number" as const, defaultValue: r.conditions.minDaysInactive ?? null }] : []),
                    ...available.map((c) => ({ name: `ch_${c}`, label: `Send via ${label(c).replace("in app", "in-app")}`, type: "checkbox" as const, defaultValue: r.channels.includes(c as never) })),
                  ]} />
                  {r.overridden && <ActionButton size="sm" variant="ghost" method="PUT" endpoint="/api/gym/automations" body={{ op: "reset", key: r.key }} success="Back to the GymPulse default">Reset</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
          {!rules.length && <p className="text-sm text-ink-3">No automations are available yet.</p>}
        </CardBody>
      </Card>
    );
  }

  async function StaffTab() {
    const staff = await ctx.db.staffMember.findMany({ include: { user: { select: { name: true, email: true, phone: true, lastLoginAt: true, mfaEnabled: true } } }, orderBy: [{ active: "desc" }, { role: "asc" }] });
    const grantable = PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p));
    return (
      <Card>
        <CardHeader title="Staff & permissions" description="Roles set sensible defaults; adjust individual permissions per person." action={<StaffInvite />} />
        <CardBody>
          <ul className="divide-y divide-line">
            {staff.map((m) => {
              const eff = effectivePermissions(m);
              return (
                <li key={m.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1">
                      <p className="font-medium">{m.user.name} <Badge className="ml-1">{m.role.toLowerCase()}</Badge>{!m.active && <Badge tone="lost" className="ml-1">Deactivated</Badge>}</p>
                      <p className="text-sm text-ink-3">{m.user.email ?? m.user.phone} · {m.user.mfaEnabled ? "2-step on" : "2-step off"} · last sign-in {m.user.lastLoginAt ? formatDate(m.user.lastLoginAt, { day: "2-digit", month: "2-digit", year: "numeric" }, g.timezone) : "never"}</p>
                    </div>
                    {m.role !== "OWNER" && m.userId !== ctx.user.id && (
                      <>
                        <FormDialog trigger={<Button size="sm" variant="secondary">Permissions</Button>} title={`${m.user.name}'s access`} description="Checked = allowed. Billing and staff management stay with the owner." endpoint={`/api/gym/staff/${m.id}`} method="PATCH"
                          transform="gym.staffPermissions" transformArgs={{ grantable }}
                          fields={[
                            { name: "role", label: "Role", type: "select", required: true, defaultValue: m.role, options: [{ value: "MANAGER", label: "Manager" }, { value: "STAFF", label: "Staff" }, { value: "TRAINER", label: "Trainer" }] },
                            ...grantable.map((p) => ({ name: `p_${p}`, label: PERMISSION_LABELS[p], type: "checkbox" as const, defaultValue: eff.has(p) })),
                          ]} />
                        <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/staff/${m.id}`} body={{ active: !m.active }} confirm={m.active ? `Deactivate ${m.user.name}? They'll be signed out.` : undefined}>{m.active ? "Deactivate" : "Reactivate"}</ActionButton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    );
  }

  async function DevicesTab() {
    const [devices, locations] = await Promise.all([ctx.db.checkInDevice.findMany({ include: { location: { select: { name: true } } }, orderBy: { createdAt: "desc" } }), activeLocations(g.id)]);
    return (
      <Card>
        <CardHeader title="Check-in devices" description="NFC card readers or kiosks that check members in by card. Each device gets its own key." action={<DeviceCreate locations={locations} />} />
        <CardBody>
          {devices.length === 0 ? <p className="text-sm text-ink-3">No devices yet. Members can still check in with the kiosk QR or at the desk.</p> : (
            <ul className="divide-y divide-line text-sm">{devices.map((d) => <li key={d.id} className="flex items-center justify-between py-2.5"><span><span className="font-medium">{d.name}</span> <span className="text-ink-3">· {d.kind === "NFC_READER" ? "NFC reader" : "Kiosk"}{d.location ? ` at ${d.location.name}` : ""} · key {d.keyPrefix}… · {d.lastSeenAt ? `last seen ${formatDate(d.lastSeenAt, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }, g.timezone)}` : "never connected"}</span></span>{d.active ? <ActionButton size="sm" variant="ghost" method="DELETE" endpoint={`/api/gym/devices/${d.id}`} confirm="Revoke this device's key?">Revoke</ActionButton> : <StatusPill status="ARCHIVED" />}</li>)}</ul>
          )}
          <p className="mt-4 text-xs text-ink-3">Devices call <code>POST {process.env.APP_URL}/api/devices/checkin</code> with <code>Authorization: Device &lt;key&gt;</code> and the card&apos;s ID. Set each member&apos;s card ID on their profile.</p>
        </CardBody>
      </Card>
    );
  }

  async function LocationsTab() {
    const locations = await ctx.db.location.findMany({ include: { _count: { select: { attendance: true, devices: true } } }, orderBy: [{ isPrimary: "desc" }, { active: "desc" }, { name: "asc" }] });
    const openCount = locations.filter((l) => l.active).length;
    const canAdd = ctx.flags.multi_location || openCount === 0;
    const fields = (l?: (typeof locations)[number]) => [
      { name: "name", label: "Branch name", required: true, defaultValue: l?.name, placeholder: "Baneshwor" },
      { name: "address", label: "Address", defaultValue: l?.address },
    ];
    return (
      <Card>
        <CardHeader title="Branches" description="Every check-in is recorded against a branch. The main branch is used when none is chosen." action={canAdd ? <FormDialog trigger={<Button size="sm">Add branch</Button>} title="New branch" endpoint="/api/gym/locations" fields={fields()} successMessage="Branch added" /> : undefined} />
        <CardBody>
          <ul className="divide-y divide-line">
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.name}{l.isPrimary && <Badge tone="brand" className="ml-2">Main</Badge>}{!l.active && <Badge className="ml-2">Closed</Badge>}</p>
                  <p className="text-sm text-ink-3">{l.address ? `${l.address} · ` : ""}{l._count.attendance.toLocaleString("en-IN")} visits · {l._count.devices} device{l._count.devices === 1 ? "" : "s"}</p>
                </div>
                <div className="flex gap-1">
                  <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title={l.name} endpoint={`/api/gym/locations/${l.id}`} method="PATCH" fields={fields(l)} />
                  {l.active && !l.isPrimary && <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/locations/${l.id}`} body={{ isPrimary: true }} success="Main branch changed">Make main</ActionButton>}
                  {!l.isPrimary && (l.active
                    ? <ActionButton size="sm" variant="ghost" method="PATCH" endpoint={`/api/gym/locations/${l.id}`} body={{ active: false }} confirm={`Close ${l.name}? Past visits are kept; staff can no longer check members in there.`} success="Branch closed">Close</ActionButton>
                    : (ctx.flags.multi_location && <ActionButton size="sm" variant="secondary" method="PATCH" endpoint={`/api/gym/locations/${l.id}`} body={{ active: true }} success="Branch reopened">Reopen</ActionButton>))}
                  {l.active && <Button asChild size="sm" variant="ghost"><Link href={`/app/kiosk?location=${l.id}`} target="_blank">Kiosk QR</Link></Button>}
                </div>
              </li>
            ))}
          </ul>
          {!ctx.flags.multi_location && <p className="mt-4 text-sm text-ink-3">Running more than one branch? Multiple branches are included in higher GymPulse plans — see the GymPulse plan tab.</p>}
        </CardBody>
      </Card>
    );
  }

  async function BillingTab() {
    const [sub, invoices] = await Promise.all([
      prisma.subscription.findUnique({ where: { gymId: g.id }, include: { plan: true } }),
      prisma.subscriptionInvoice.findMany({ where: { gymId: g.id }, orderBy: { periodStart: "desc" }, take: 12 }),
    ]);
    const kinds: [LimitKind, string, number | null | undefined][] = [["members", "Members", sub?.plan.memberLimit], ["staff", "Staff", sub?.plan.staffLimit], ["importsPerMonth", "Imports this month", sub?.plan.importsPerMonth], ["predictionsPerMonth", "Estimates this month", sub?.plan.predictionsPerMonth], ["notificationsPerMonth", "Messages this month", sub?.plan.notificationsPerMonth]];
    const used = await Promise.all(kinds.map(([k]) => usage(g.id, k, g.timezone)));
    return (
      <>
        <Card>
          <CardHeader title={sub ? `${sub.plan.name} plan` : "No subscription"} description={sub ? `${formatMoney(sub.plan.pricePaisa)}/${sub.plan.billingPeriod === "YEARLY" ? "year" : "month"} · ${sub.status === "TRIALING" ? `trial ends ${formatDate(sub.currentPeriodEnd, { day: "2-digit", month: "2-digit", year: "numeric" }, g.timezone)}` : `renews ${formatDate(sub.currentPeriodEnd, { day: "2-digit", month: "2-digit", year: "numeric" }, g.timezone)}`}` : undefined} action={sub && <StatusPill status={sub.status} />} />
          <CardBody>
            <dl className="divide-y divide-line">{kinds.map(([k, l, lim], i) => <Row key={k} k={l} v={`${used[i]} / ${lim ?? "unlimited"}`} />)}</dl>
            <p className="mt-4 text-sm text-ink-3">To change plan or pay by bank transfer, contact GymPulse from the Support tab.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Invoices" />
          <CardBody>{invoices.length === 0 ? <p className="text-sm text-ink-3">No invoices yet.</p> : (
            <ul className="divide-y divide-line text-sm">{invoices.map((i) => <li key={i.id} className="flex justify-between py-2.5"><span className="num">{i.number} <span className="text-ink-3">· {formatDate(i.periodStart, { day: "2-digit", month: "2-digit", year: "numeric" }, g.timezone)}</span></span><span className="flex items-center gap-2"><StatusPill status={i.status === "DUE" ? "PENDING" : i.status} /><span className="num">{formatMoney(i.amountPaisa)}</span></span></li>)}</ul>
          )}</CardBody>
        </Card>
      </>
    );
  }

  async function AuditTab() {
    const logs = await prisma.auditLog.findMany({ where: { gymId: g.id }, orderBy: { createdAt: "desc" }, take: 100 });
    return (
      <Card>
        <CardHeader title="Audit log" description="Every privileged action at your gym, including GymPulse support access." />
        <CardBody>
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>What</Th></tr></thead>
            <tbody>{logs.map((l) => <tr key={l.id}><Td className="whitespace-nowrap">{l.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: g.timezone })}</Td><Td>{l.actorName ?? l.actorType.toLowerCase()}{l.actorRole ? <span className="text-ink-3"> · {l.actorRole.toLowerCase()}</span> : null}</Td><Td className="font-medium">{l.action}</Td><Td className="text-ink-3">{l.entityType}</Td></tr>)}</tbody>
          </Table>
        </CardBody>
      </Card>
    );
  }

  async function SupportTab() {
    const tickets = await prisma.supportTicket.findMany({ where: { gymId: g.id }, include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 20 });
    return (
      <Card>
        <CardHeader title="Support" description="Questions about imports, payments, billing or anything else." action={<FormDialog trigger={<Button size="sm">New request</Button>} title="Contact GymPulse support" endpoint="/api/gym/support" successMessage="Request sent" fields={[
          { name: "subject", label: "Subject", required: true },
          { name: "category", label: "Topic", type: "select", required: true, options: [{ value: "general", label: "General" }, { value: "imports", label: "Record imports" }, { value: "payments", label: "Payments" }, { value: "billing", label: "Billing" }, { value: "plan_change", label: "Change my plan" }, { value: "bug", label: "Something isn't working" }] },
          { name: "priority", label: "Urgency", type: "select", required: true, defaultValue: "NORMAL", options: [{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent — gym can't operate" }] },
          { name: "body", label: "Details", type: "textarea", required: true },
        ]} />} />
        <CardBody>
          {tickets.length === 0 ? <p className="text-sm text-ink-3">No requests yet.</p> : (
            <ul className="space-y-4">{tickets.map((t) => (
              <li key={t.id} className="rounded-2xl bg-mist p-4">
                <div className="flex justify-between gap-2"><p className="font-medium">#{t.number} {t.subject}</p><StatusPill status={t.status} /></div>
                <ul className="mt-2 space-y-2 text-sm">{t.messages.map((m) => <li key={m.id}><span className="font-medium">{m.authorType === "ADMIN" ? `${m.authorName} (GymPulse)` : m.authorName}:</span> {m.body}</li>)}</ul>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>
    );
  }
}
