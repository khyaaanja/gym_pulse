import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { adminCan, type AdminPermission } from "@/lib/rbac";
import { AdminShell } from "@/components/admin/shell";
import { PageTransition } from "@/components/motion/page-transition";

export const dynamic = "force-dynamic";

const NAV: [string, string, AdminPermission][] = [
  ["/super-admin", "Overview", "analytics.view"],
  ["/super-admin/gyms", "Gyms", "gyms.view"],
  ["/super-admin/members", "Members", "members.view"],
  ["/super-admin/subscriptions", "Subscriptions", "billing.view"],
  ["/super-admin/plans", "Plans", "billing.view"],
  ["/super-admin/flags", "Feature Flags", "flags.manage"],
  ["/super-admin/automations", "Automations", "automations.manage"],
  ["/super-admin/notifications", "Notifications", "notifications.manage"],
  ["/super-admin/marketplace", "Marketplace", "marketplace.manage"],
  ["/super-admin/vendors", "Vendors", "vendors.manage"],
  ["/super-admin/payments", "Payments", "payments.manage"],
  ["/super-admin/content", "Content", "content.manage"],
  ["/super-admin/announcements", "Announcements", "announcements.manage"],
  ["/super-admin/support", "Support", "support.manage"],
  ["/super-admin/imports", "Imports", "imports.view"],
  ["/super-admin/prediction", "Prediction Engine", "prediction.manage"],
  ["/super-admin/analytics", "Analytics", "analytics.view"],
  ["/super-admin/reports", "Reports", "analytics.view"],
  ["/super-admin/security", "Security", "security.manage"],
  ["/super-admin/audit", "Audit Logs", "audit.view"],
  ["/super-admin/system", "System", "system.manage"],
  ["/super-admin/settings", "Settings", "settings.manage"],
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await getAdminSession("full");
  if (!s) {
    const partial = await getAdminSession("partial");
    redirect(partial ? "/super-admin/login/mfa" : "/super-admin/login");
  }
  const nav = NAV.filter(([, , p]) => adminCan(s.admin.role, p)).map(([href, label]) => ({ href, label }));
  return (
    <AdminShell nav={nav} name={s.admin.name} role={s.admin.role.replace("_", " ").toLowerCase()} mfaWarning={!s.admin.mfaEnabled && process.env.ALLOW_ADMIN_WITHOUT_MFA === "true"}>
      <PageTransition>{children}</PageTransition>
    </AdminShell>
  );
}
