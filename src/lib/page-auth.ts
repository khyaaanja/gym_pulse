import { redirect, notFound } from "next/navigation";
import { adminSetupStep, getAdminSession, getUserSession, pendingSetup, requestMeta, SETUP_PATH } from "./auth/session";
import { resolveMemberContext, resolveStaffContext, type GymContext, type MemberContext } from "./api";
import { adminCan, type AdminPermission, type Permission } from "./rbac";
import { prisma } from "@/db/client";

/**
 * The signed-in user for a page. Pending account setup (required MFA, temporary password) sends them to the
 * security screen first; only that screen (and the /app layout around it) passes `allowSetup`.
 */
async function pageSession(allowSetup = false) {
  const session = await getUserSession({ allowSetup: true });
  if (!session) {
    const partial = await getUserSession({ requireMfa: false, allowSetup: true });
    redirect(partial ? "/login/mfa" : "/login");
  }
  const step = pendingSetup(session.user);
  if (step && !allowSetup) redirect(SETUP_PATH[step]);
  return session;
}

/** Server-component guard for staff pages. Authorization is enforced here, not in the UI. */
export async function requireStaff(permission?: Permission): Promise<GymContext> {
  const session = await pageSession();
  const ctx = await resolveStaffContext(session, await requestMeta());
  if (!ctx) redirect("/app");
  if (ctx.gym.status === "SUSPENDED" || ctx.gym.status === "ARCHIVED") redirect("/app/suspended");
  if (permission && !ctx.perms.has(permission)) redirect("/app/forbidden");
  return ctx;
}

export async function requireMember(): Promise<MemberContext> {
  const session = await pageSession();
  const ctx = await resolveMemberContext(session, await requestMeta());
  if (!ctx) redirect("/app");
  return ctx;
}

export type AppMode =
  | { kind: "staff"; ctx: GymContext }
  | { kind: "member"; ctx: MemberContext }
  | { kind: "vendor"; vendorId: string; userName: string }
  | { kind: "none"; userName: string; userId: string };

/** What the signed-in user is in the active gym: staff first, then member, then vendor. */
export async function appMode(opts: { allowSetup?: boolean } = {}): Promise<AppMode> {
  const session = await pageSession(opts.allowSetup);
  const meta = await requestMeta();
  const staff = await resolveStaffContext(session, meta);
  if (staff) return { kind: "staff", ctx: staff };
  const member = await resolveMemberContext(session, meta);
  if (member) return { kind: "member", ctx: member };
  const vendor = await prisma.vendorUser.findFirst({ where: { userId: session.userId } });
  if (vendor) return { kind: "vendor", vendorId: vendor.vendorId, userName: session.user.name };
  return { kind: "none", userName: session.user.name, userId: session.userId };
}

export async function requireAdmin(permission: AdminPermission) {
  const session = await getAdminSession("full");
  if (!session) {
    const partial = await getAdminSession("partial");
    redirect((partial && adminSetupStep(partial)) || "/super-admin/login");
  }
  if (!adminCan(session.admin.role, permission)) notFound();
  return session;
}
