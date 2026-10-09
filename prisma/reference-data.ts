/**
 * Platform reference data every installation needs: SaaS plans, feature flags, prediction defaults, platform
 * settings, payment providers (eSewa, Khalti), notification templates, automation rules, marketplace categories,
 * commission rules and website/legal content. No demo gyms, no demo admins, no test gateway.
 *
 * Used by the demo seed (prisma/seed.ts) and the production bootstrap (prisma/bootstrap.ts). Every write is
 * create-if-missing; only `overwrite: true` (the demo seed) resets plans and flags to these values, so the
 * production bootstrap never undoes what a super-admin has edited.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { Channel } from "@/generated/prisma/enums";
import { DEFAULT_TEMPLATES, type TemplateKey } from "@/services/notifications/templates";
import { LEGAL_DOCS } from "@/content/legal";
import { hashPassword, passwordSchema } from "@/lib/auth/password";

export type ReferenceDataOptions = { overwrite: boolean; supportEmail: string };

export async function platformReferenceData(db: PrismaClient, opts: ReferenceDataOptions) {
  const plans = [
    { key: "starter", name: "Starter", pricePaisa: 199_900, memberLimit: 100, staffLimit: 3, storageLimitMb: 500, importsPerMonth: 5, predictionsPerMonth: 10, notificationsPerMonth: 1000, sortOrder: 1, freeMonths: 1, highlights: ["Up to 100 members and 3 staff", "Daily list of members who may leave", "5 imports and 10 risk estimates a month", "SMS, email and in-app reminders"] },
    { key: "growth", name: "Growth", pricePaisa: 349_900, memberLimit: 300, staffLimit: 10, storageLimitMb: 2000, importsPerMonth: 20, predictionsPerMonth: 50, notificationsPerMonth: 5000, sortOrder: 2, freeMonths: 3, highlights: ["Up to 300 members and 10 staff", "20 imports and 50 risk estimates a month", "WhatsApp reminders", "Your own shop for PT packs and classes"] },
    { key: "pro", name: "Pro", pricePaisa: 599_900, memberLimit: 500, staffLimit: null, storageLimitMb: 10000, importsPerMonth: null, predictionsPerMonth: null, notificationsPerMonth: 20000, sortOrder: 3, freeMonths: 5, highlights: ["Up to 500 members, no staff limit", "Unlimited imports and risk estimates", "More than one branch", "Your gym's brand color in the app"] },
  ];
  const planRows: Record<string, { id: string }> = {};
  for (const p of plans) planRows[p.key] = await db.saasPlan.upsert({ where: { key: p.key }, create: p, update: opts.overwrite ? p : {} });

  const flags: [string, "GLOBAL" | "PLAN", string, boolean][] = [
    ["ocr_import", "GLOBAL", "", true],
    ["advanced_analytics", "PLAN", planRows.growth!.id, true],
    ["whatsapp", "PLAN", planRows.growth!.id, true],
    ["advanced_analytics", "PLAN", planRows.pro!.id, true],
    ["whatsapp", "PLAN", planRows.pro!.id, true],
    ["multi_location", "PLAN", planRows.pro!.id, true],
    ["api_access", "PLAN", planRows.pro!.id, true],
    ["custom_branding", "PLAN", planRows.pro!.id, true],
    ["marketplace", "PLAN", planRows.starter!.id, false],
  ];
  for (const [key, scope, scopeId, enabled] of flags) {
    await db.featureFlag.upsert({ where: { key_scope_scopeId: { key, scope, scopeId } }, create: { key, scope, scopeId, enabled }, update: opts.overwrite ? { enabled } : {} });
  }

  if (!(await db.predictionConfig.findFirst({ where: { gymId: null } }))) await db.predictionConfig.create({ data: {} });

  const settings: [string, unknown, string][] = [
    ["pricing.customDeployment", { setupMinPaisa: 3_000_000, setupMaxPaisa: 5_000_000, maintenanceMinPaisa: 200_000, maintenanceMaxPaisa: 500_000 }, "Custom deployment pricing shown on the website"],
    ["roi.example", { membersRetained: 20, monthlyFeePaisa: 150_000, months: 12, buildShareBps: 1000 }, "ROI example on the website (always labelled as an example)"],
    ["platform.trialDays", 14, "Trial length for new gyms"],
    ["platform.supportEmail", opts.supportEmail, "Support contact"],
    ["platform.defaultPlan", "starter", "Plan assigned to new gyms"],
  ];
  for (const [key, value, description] of settings) await db.platformSetting.upsert({ where: { key }, create: { key, value: value as never, description }, update: {} });

  for (const p of [
    { providerKey: "esewa", displayName: "eSewa", enabled: true, methods: ["wallet"] },
    { providerKey: "khalti", displayName: "Khalti", enabled: true, methods: ["wallet", "ebanking", "mobile_banking", "connect_ips"] },
  ]) {
    const existing = await db.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: p.providerKey } });
    if (!existing) await db.paymentProviderConfig.create({ data: { ...p, gymId: null } });
  }

  for (const [key, t] of Object.entries(DEFAULT_TEMPLATES) as [TemplateKey, { subject: string; body: string }][]) {
    for (const channel of ["IN_APP", "SMS", "EMAIL"] as Channel[]) {
      const existing = await db.notificationTemplate.findFirst({ where: { gymId: null, key, channel } });
      if (!existing) await db.notificationTemplate.create({ data: { gymId: null, key, channel, name: key.replace(/_/g, " ").toLowerCase(), subject: t.subject, body: t.body, status: "PUBLISHED", version: 1 } });
    }
  }

  const rules = [
    { key: "inactive-staff-alert", name: "Alert staff when a member reaches 10 days inactive", trigger: "MEMBER_INACTIVE", action: "NOTIFY_STAFF", audience: "STAFF", actionConfig: { template: "STAFF_AT_RISK", channels: ["IN_APP"], roles: ["OWNER", "MANAGER", "STAFF"] }, priority: 10 },
    { key: "inactive-member-nudge", name: "Friendly nudge after 14 days without a visit", trigger: "MEMBER_INACTIVE", action: "SEND_NOTIFICATION", audience: "MEMBER", conditions: { minDaysInactive: 14 }, actionConfig: { template: "INACTIVITY", channels: ["IN_APP", "SMS"] }, priority: 5 },
    { key: "renewal-sequence", name: "Renewal reminders (7, 3, 1 days before and on expiry)", trigger: "MEMBERSHIP_EXPIRING", action: "SEND_NOTIFICATION", audience: "MEMBER", actionConfig: { template: "RENEWAL_REMINDER" }, priority: 10 },
    { key: "expired-followup", name: "Post-expiry reminder", trigger: "MEMBERSHIP_EXPIRED", action: "SEND_NOTIFICATION", audience: "MEMBER", actionConfig: { template: "MEMBERSHIP_EXPIRED" }, priority: 5 },
    { key: "payment-failed", name: "Payment recovery message", trigger: "PAYMENT_FAILED", action: "SEND_NOTIFICATION", audience: "MEMBER", actionConfig: { template: "PAYMENT_FAILED", channels: ["IN_APP", "SMS"] }, priority: 10 },
    { key: "milestone-reward", name: "Celebrate milestones", trigger: "MILESTONE_REACHED", action: "SEND_NOTIFICATION", audience: "MEMBER", actionConfig: { template: "MILESTONE_REACHED", channels: ["IN_APP"] }, priority: 5 },
    { key: "marketplace-booking", name: "Booking + trainer notification after purchase", trigger: "MARKETPLACE_PURCHASE", action: "CREATE_BOOKING", audience: "STAFF", actionConfig: {}, priority: 5 },
  ] as const;
  for (const r of rules) {
    const existing = await db.automationRule.findFirst({ where: { gymId: null, key: r.key } });
    if (!existing) await db.automationRule.create({ data: { ...r, gymId: null, conditions: ("conditions" in r ? r.conditions : {}) as never, actionConfig: r.actionConfig as never } });
  }

  const cats = [
    ["Personal Training", "personal-training", "SERVICE"], ["Diet Plans", "diet-plans", "SERVICE"], ["Yoga", "yoga", "SERVICE"], ["Zumba", "zumba", "SERVICE"],
    ["Boxing", "boxing", "SERVICE"], ["Fitness Assessments", "fitness-assessments", "SERVICE"], ["Recovery Sessions", "recovery", "SERVICE"], ["Classes", "classes", "SERVICE"],
    ["Merchandise", "merchandise", "PRODUCT"], ["Accessories", "accessories", "PRODUCT"], ["Supplements", "supplements", "PRODUCT"], ["Equipment", "equipment", "PRODUCT"],
  ] as const;
  for (const [i, [name, slug, kind]] of cats.entries()) await db.marketplaceCategory.upsert({ where: { slug }, create: { name, slug, kind, sortOrder: i }, update: {} });
  const supplements = await db.marketplaceCategory.findUniqueOrThrow({ where: { slug: "supplements" } });

  if (!(await db.commissionRule.count())) {
    await db.commissionRule.createMany({
      data: [
        { name: "Platform default", scope: "PLATFORM_DEFAULT", platformBps: 1000, gymBps: 2000, vendorBps: 7000 },
        { name: "Supplements", scope: "CATEGORY", categoryId: supplements.id, platformBps: 1200, gymBps: 1800, vendorBps: 7000 },
      ],
    });
  }

  const content: [string, string, string, unknown][] = [
    ["WEBSITE", "hero", "Hero", {"eyebrow": "For gyms in Nepal", "title": "Know which members may leave — before they go.", "subtitle": "GymPulse reads your attendance and membership records. Every day it shows you who to call, how much money is at risk, and who came back.", "primaryCta": "Start free trial", "secondaryCta": "See how it works"}],
    ["WEBSITE", "features", "Features", { items: [
      {"title": "Members at risk", "body": "If an active member has not come in for 10 days, they appear on your Pulse screen with the reason and the money involved."},
      {"title": "Use your old records", "body": "Upload your Excel sheet or take a photo of your paper register. We tidy it up, you check it, and then we show who may leave."},
      {"title": "Renew and pay", "body": "Members get a reminder before their plan ends and can renew in one tap with eSewa or Khalti. A payment counts only after eSewa or Khalti confirms it."},
      {"title": "Streaks that keep members coming", "body": "Check-in streaks, milestones and monthly challenges give members a reason to come back."},
      {"title": "Earn more from each member", "body": "Sell PT packs, diet plans and classes in your gym's own shop, with no pushy selling. On Growth and Pro plans."},
      {"title": "Clear reasons", "body": "Every risk estimate shows why: the visit trend, the last visit and when the plan ends. Nothing is hidden, and nothing is promised."},
    ] }],
    ["WEBSITE", "testimonials", "Testimonials", { items: [] , note: "Add real customer testimonials here once you have permission to publish them." }],
    ["WEBSITE", "faqs", "FAQs", { items: [
      {"q": "Do my records need to be clean?", "a": "No. Upload what you have: Excel, CSV, PDF or a photo. Before anything is imported, we show you every row we are not sure about."},
      {"q": "How correct are the risk estimates?", "a": "They are estimates, not facts. They come from clear rules and are shown as a range with a confidence level. We compare them with what really happened, and we never say they are certain."},
      {"q": "How can members pay?", "a": "Online with eSewa or Khalti, using your own merchant accounts. Your staff can also record cash and bank payments at the front desk."},
      {"q": "Who can see my members' data?", "a": "Only your staff, with the permissions you give them. If GymPulse support searches your members or changes your gym's account, it shows in your audit log."},
    ] }],
    ["WEBSITE", "cta", "Call to action", {"title": "See your money at risk in minutes.", "body": "Add your attendance register or member list and see who may stop coming. It is free, you don't need an account, and nothing is saved.", "button": "Check my records"}],
    ["APP", "onboarding", "Onboarding", { steps: ["Create your gym", "Add membership plans", "Import or add members", "Start checking members in"] }],
    ["APP", "empty_states", "Empty states", { noAtRisk: { title: "No members at risk", body: "🎉 Your members are showing up. We'll alert you automatically when someone reaches 10 days without a visit." }, noImports: { title: "No records imported", body: "Understand your member risk in minutes. Upload your attendance sheet to generate an estimated churn report.", cta: "Analyze Records" } }],
    ["APP", "help", "Help", { articles: [{ title: "How is 'at risk' decided?", body: "A member with an active membership who hasn't checked in for 10 days (configurable) is marked At Risk." }] }],
    ...(Object.entries(LEGAL_DOCS).map(([key, d]) => ["LEGAL", key, d.title, { body: d.body }]) as [string, string, string, object][]),
    ["MARKETPLACE", "banners", "Marketplace banners", { items: [{ title: "Personal training packs", subtitle: "Work 1:1 with a certified trainer" }] }],
  ];
  for (const [section, key, title, data] of content) {
    const exists = await db.contentEntry.findFirst({ where: { section: section as never, key } });
    if (!exists) await db.contentEntry.create({ data: { section: section as never, key, title, data: data as never, status: "PUBLISHED", version: 1, publishedAt: new Date() } });
  }
  return planRows;
}

export type BootstrapOptions = { adminEmail: string; adminPassword: string; adminName?: string; supportEmail: string };
export type BootstrapResult = { adminCreated: boolean; adminEmail: string | null };

const PLACEHOLDER_EMAIL = /(@(gympulse\.(example|local)|example\.(com|org|net))|\.demo)$/i;

/**
 * Production first run: reference data plus the first super-admin. Idempotent: the admin is created only while no
 * SUPER_ADMIN exists, and reference data is never overwritten. Like admins created from the console, the new admin
 * must reset the password and enrol MFA at first sign-in.
 */
export async function bootstrapPlatform(db: PrismaClient, opts: BootstrapOptions): Promise<BootstrapResult> {
  const adminEmail = opts.adminEmail.trim().toLowerCase();
  const supportEmail = opts.supportEmail.trim();
  for (const [name, value] of [["admin email", adminEmail], ["support email", supportEmail]] as const) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Bootstrap: ${name} "${value}" is not an email address`);
    if (PLACEHOLDER_EMAIL.test(value)) throw new Error(`Bootstrap: ${name} "${value}" is a placeholder; use a real address`);
  }
  const pw = passwordSchema.safeParse(opts.adminPassword);
  if (!pw.success) throw new Error(`Bootstrap: admin password rejected: ${pw.error.issues.map((i) => i.message).join("; ")}`);
  // The platform owner's account can reach every gym: hold it to more than the console's 10-character minimum.
  if (opts.adminPassword.length < 16) throw new Error("Bootstrap: admin password rejected: use at least 16 characters.");

  await platformReferenceData(db, { overwrite: false, supportEmail });

  if (await db.platformAdmin.count({ where: { role: "SUPER_ADMIN" } })) return { adminCreated: false, adminEmail: null };
  const admin = await db.platformAdmin.create({
    data: { email: adminEmail, name: opts.adminName?.trim() || "Platform owner", role: "SUPER_ADMIN", passwordHash: await hashPassword(opts.adminPassword), mustResetPassword: true, mfaRequired: true },
  });
  await db.auditLog.create({ data: { actorType: "SYSTEM", action: "admins.bootstrapped", entityType: "PlatformAdmin", entityId: admin.id, metadata: { email: admin.email, role: admin.role } } });
  return { adminCreated: true, adminEmail: admin.email };
}
