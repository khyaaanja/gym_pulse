import { redirect } from "next/navigation";
import { appMode } from "@/lib/page-auth";
import { pendingSetup } from "@/lib/auth/session";
import { prisma } from "@/db/client";
import { AppShell, type NavItem } from "@/components/app/shell";
import { PageTransition } from "@/components/motion/page-transition";
import { NoGym } from "@/components/app/no-gym";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The layout also wraps the security screen, where pending account setup is finished; each page enforces it.
  const mode = await appMode({ allowSetup: true });
  if (mode.kind === "vendor") redirect("/vendor");
  if (mode.kind === "none") return <NoGym userId={mode.userId} userName={mode.userName} />;
  const userId = mode.ctx.user.id;
  // Notifications stay closed until account setup is done, matching the fail-closed /api/notifications.
  const setupPending = pendingSetup(mode.ctx.user) !== null;
  const [unread, staffAt, memberAt] = await Promise.all([
    setupPending ? 0 : prisma.notification.count({ where: { userId, channel: "IN_APP", readAt: null } }),
    prisma.staffMember.findMany({ where: { userId, active: true, gym: { status: { not: "ARCHIVED" } } }, select: { role: true, gym: { select: { id: true, name: true } } } }),
    prisma.member.findMany({ where: { userId, archivedAt: null }, select: { gym: { select: { id: true, name: true } } } }),
  ]);
  const cap = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();
  // One entry per gym; where someone is both staff and a member, the staff role wins.
  const gyms = [...new Map([...memberAt.map((m) => ({ ...m.gym, role: "Member" })), ...staffAt.map((s) => ({ ...s.gym, role: cap(s.role) }))].map((g) => [g.id, g])).values()];

  let nav: NavItem[];
  let role: string;
  if (mode.kind === "staff") {
    const c = mode.ctx;
    role = c.staff.role.charAt(0) + c.staff.role.slice(1).toLowerCase();
    nav = [
      // Each link follows the permission its page checks, so staff with custom permissions never see a dead link.
      ...(c.can("members.view") ? [{ href: "/app/pulse", label: "Pulse", icon: "pulse" as const, primary: true }] : []),
      ...(c.can("attendance.view") ? [{ href: "/app/attendance", label: "Attendance", icon: "attendance" as const, primary: true }] : []),
      { href: "/app/renew", label: "Renew", icon: "renew", primary: true },
      { href: "/app/marketplace", label: "Marketplace", icon: "market", primary: true },
      ...(c.can("reports.view") ? [{ href: "/app", label: "Overview", icon: "overview" as const }] : []),
      ...(c.can("members.view") ? [{ href: "/app/members", label: "Members", icon: "members" as const }] : []),
      ...(c.can("bookings.manage") ? [{ href: "/app/bookings", label: "Bookings", icon: "bookings" as const }] : []),
      ...(c.can("leads.manage") || c.can("promotions.manage") ? [{ href: "/app/grow", label: "Grow", icon: "grow" as const }] : []),
      ...(c.can("diet.manage") ? [{ href: "/app/diet", label: "Diet plans", icon: "diet" as const }] : []),
      ...(c.can("prediction.view") && c.flags.churn_prediction ? [{ href: "/app/forecast", label: "Know Your Gym", icon: "forecast" as const }] : []),
      ...(c.can("imports.view") && c.flags.file_import ? [{ href: "/app/imports", label: "Analyze Records", icon: "imports" as const }] : []),
      ...(c.can("reports.view") ? [{ href: "/app/reports", label: "Reports", icon: "reports" as const }] : []),
      ...(c.can("settings.manage") ? [{ href: "/app/announcements", label: "Announcements", icon: "news" as const }] : []),
      ...(c.can("settings.manage") || c.can("staff.manage") || c.can("billing.manage") ? [{ href: "/app/settings", label: "Settings", icon: "settings" as const }] : []),
    ];
    // Same rule as the Marketplace page itself (marketplace or bookings access), so the menu never links to "no access".
    if (!c.flags.marketplace || (!c.can("marketplace.manage") && !c.can("bookings.manage"))) nav = nav.filter((n) => n.href !== "/app/marketplace");
  } else {
    role = "Member";
    nav = [
      { href: "/app", label: "Home", icon: "home", primary: true },
      { href: "/app/attendance", label: "Progress", icon: "trophy", primary: true },
      { href: "/app/renew", label: "Renew", icon: "renew", primary: true },
      { href: "/app/diet", label: "Diet", icon: "diet", primary: true },
      ...(mode.ctx.flags.marketplace ? [{ href: "/app/marketplace", label: "Marketplace", icon: "market" as const, primary: true }] : []),
    ];
  }
  return (
    <AppShell nav={nav} gymName={mode.ctx.gym.name} gymId={mode.ctx.gym.id} gyms={gyms} userName={mode.ctx.user.name} role={role} staff={mode.kind === "staff"} unread={unread} notificationsLive={!setupPending}>
      <PageTransition>{children}</PageTransition>
    </AppShell>
  );
}
