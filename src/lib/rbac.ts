import type { StaffRole, PlatformRole } from "@/generated/prisma/enums";

export const PERMISSIONS = [
  "members.view",
  "members.edit",
  "members.invite",
  "members.delete",
  "attendance.view",
  "attendance.create",
  "payments.view",
  "payments.manage",
  "reports.view",
  "imports.create",
  "imports.view",
  "prediction.view",
  "recovery.manage",
  "notifications.send",
  "marketplace.manage",
  "bookings.manage",
  "plans.manage",
  "settings.manage",
  "staff.manage",
  "billing.manage",
  "audit.view",
  "leads.manage",
  "promotions.manage",
  "diet.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "members.view": "View members",
  "members.edit": "Add and edit members",
  "members.invite": "Invite members",
  "members.delete": "Archive members",
  "attendance.view": "View attendance",
  "attendance.create": "Check members in",
  "payments.view": "View payments",
  "payments.manage": "Record payments and refunds",
  "reports.view": "View and export reports",
  "imports.create": "Upload record sheets",
  "imports.view": "View imported records",
  "prediction.view": "View churn estimates",
  "recovery.manage": "Run recovery follow-ups",
  "notifications.send": "Send member messages",
  "marketplace.manage": "Manage marketplace",
  "bookings.manage": "Manage bookings",
  "plans.manage": "Manage membership plans and prices",
  "settings.manage": "Change gym settings",
  "staff.manage": "Manage staff and permissions",
  "billing.manage": "Manage GymPulse subscription",
  "audit.view": "View audit log",
  "leads.manage": "Follow up new enquiries (leads)",
  "promotions.manage": "Run offers and the public gym page",
  "diet.manage": "Write and assign diet plans",
};

/** Permissions only an owner may hold; they can't be granted to other roles. */
export const OWNER_ONLY: Permission[] = ["billing.manage", "staff.manage"];

export const ROLE_DEFAULTS: Record<StaffRole, Permission[]> = {
  OWNER: [...PERMISSIONS],
  MANAGER: [
    "members.view",
    "members.edit",
    "members.invite",
    "attendance.view",
    "attendance.create",
    "payments.view",
    "reports.view",
    "imports.create",
    "imports.view",
    "prediction.view",
    "recovery.manage",
    "notifications.send",
    "marketplace.manage",
    "bookings.manage",
    "leads.manage",
    "promotions.manage",
    "diet.manage",
  ],
  STAFF: ["members.view", "members.edit", "members.invite", "attendance.view", "attendance.create", "recovery.manage", "notifications.send", "leads.manage"],
  TRAINER: ["members.view", "attendance.view", "attendance.create", "bookings.manage", "diet.manage"],
};

export function effectivePermissions(staff: {
  role: StaffRole;
  grantedPermissions: string[];
  revokedPermissions: string[];
}): Set<Permission> {
  const set = new Set<Permission>(ROLE_DEFAULTS[staff.role]);
  const valid = new Set<string>(PERMISSIONS);
  for (const p of staff.grantedPermissions) {
    if (!valid.has(p)) continue;
    if (staff.role !== "OWNER" && OWNER_ONLY.includes(p as Permission)) continue;
    set.add(p as Permission);
  }
  // Owners can't lose permissions — otherwise a gym could lock itself out.
  if (staff.role !== "OWNER") for (const p of staff.revokedPermissions) set.delete(p as Permission);
  return set;
}

// ───── Platform (super-admin) permissions ─────

export const ADMIN_PERMISSIONS = {
  "gyms.view": ["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"],
  "gyms.manage": ["SUPER_ADMIN"],
  "gyms.support": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "members.view": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "billing.view": ["SUPER_ADMIN", "FINANCE_ADMIN"],
  "billing.manage": ["SUPER_ADMIN", "FINANCE_ADMIN"],
  "plans.manage": ["SUPER_ADMIN"],
  "flags.manage": ["SUPER_ADMIN"],
  "automations.manage": ["SUPER_ADMIN"],
  "notifications.manage": ["SUPER_ADMIN"],
  "marketplace.manage": ["SUPER_ADMIN"],
  "vendors.manage": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "payments.manage": ["SUPER_ADMIN", "FINANCE_ADMIN"],
  "content.manage": ["SUPER_ADMIN"],
  "announcements.manage": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "support.manage": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "imports.view": ["SUPER_ADMIN", "SUPPORT_ADMIN"],
  "prediction.manage": ["SUPER_ADMIN"],
  "analytics.view": ["SUPER_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN"],
  "security.manage": ["SUPER_ADMIN"],
  "audit.view": ["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"],
  "system.manage": ["SUPER_ADMIN"],
  "settings.manage": ["SUPER_ADMIN"],
  "admins.manage": ["SUPER_ADMIN"],
} satisfies Record<string, PlatformRole[]>;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export function adminCan(role: PlatformRole, permission: AdminPermission): boolean {
  return (ADMIN_PERMISSIONS[permission] as PlatformRole[]).includes(role);
}
