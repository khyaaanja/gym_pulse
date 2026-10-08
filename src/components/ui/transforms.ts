"use client";
/**
 * Named form → request-body transforms for FormDialog.
 *
 * Server components can't pass functions to client components, so dialogs refer to a
 * transform by key plus serialisable args. Keeping them here also means every body shape
 * sent to the API is reviewable in one place.
 */
import { DEFAULT_LABELS, DEFAULT_WEIGHTS } from "@/config/prediction-defaults";
import { effectivePermissions } from "@/lib/rbac";
import { localInstant } from "@/lib/time";

type V = Record<string, unknown>;
type A = Record<string, unknown>;

const str = (x: unknown) => (x === null || x === undefined ? "" : String(x));
const channels = (v: V) => ["IN_APP", "SMS", "EMAIL", "WHATSAPP"].filter((c) => v[`ch_${c}`]);
const parseJsonOr = (x: unknown) => {
  try {
    return JSON.parse(str(x));
  } catch {
    return str(x);
  }
};

/** Empty optional text is left out of the body (the settings schema has no nulls). */
const opt = (x: unknown) => (x === null || x === undefined || str(x).trim() === "" ? undefined : str(x).trim());
const numOrNull = (x: unknown) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Math.round(Number(x)));
/** A date field arrives as an ISO instant at UTC midnight; pin it to that calendar day in the gym's timezone (`a.tz`). */
const gymDay = (x: unknown, time: string, a: A) => localInstant(str(x).slice(0, 10), time, typeof a.tz === "string" ? a.tz : undefined).toISOString();

/** One meal per line: `time | meal | what to eat | kcal` (time and kcal optional). The inverse is mealsToText in services/diet. */
export function parseMeals(text: unknown) {
  return str(text).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12).map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length === 1) return { time: "", name: "Meal", items: parts[0]!, calories: null };
    if (parts.length === 2) return { time: "", name: parts[0]!, items: parts[1]!, calories: null };
    const last = parts[parts.length - 1]!;
    const kcal = parts.length >= 4 && /^\d+$/.test(last.replace(/\s*kcal$/i, "")) ? Number(last.replace(/\s*kcal$/i, "")) : null;
    return { time: parts[0]!, name: parts[1]!, items: (kcal === null ? parts.slice(2) : parts.slice(2, -1)).join(" | "), calories: kcal };
  });
}

const dietPlan = (v: V) => ({
  title: v.title, goal: v.goal || "GENERAL_HEALTH", dailyCalories: numOrNull(v.dailyCalories), proteinG: numOrNull(v.proteinG), carbsG: numOrNull(v.carbsG),
  fatG: numOrNull(v.fatG), waterMl: numOrNull(v.waterMl), meals: parseMeals(v.meals), notes: v.notes ?? null,
});

export const TRANSFORMS = {
  // ── gym settings ──
  "gym.profile": (v: V) => ({ profile: v }),
  "gym.attendance": (v: V, a: A) => ({
    settings: { attendance: { ...(a.attendance as object), allowSelfQr: !!v.allowSelfQr, requireActiveMembership: !!v.requireActiveMembership } },
    retention: { inactivityThresholdDays: Number(v.inactivityThresholdDays), protectedRevenueMonths: Number(v.protectedRevenueMonths) },
  }),
  "gym.reminders": (v: V) => ({
    settings: {
      renewal: {
        reminderOffsetsDays: str(v.offsets).split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x)),
        gracePeriodDays: Number(v.grace),
        channels: ["IN_APP", ...(v.sms ? ["SMS"] : []), ...(v.email ? ["EMAIL"] : []), ...(v.whatsapp ? ["WHATSAPP"] : [])],
      },
      imports: { rawFileRetentionDays: Number(v.retention), dateOrder: v.dateOrder },
      marketplace: { contextualSuggestions: !!v.suggest },
    },
  }),
  "gym.paymentProvider": (v: V, a: A) => ({ providerKey: a.providerKey, environment: v.environment, enabled: !!v.enabled, credentials: Object.fromEntries((a.fields as string[]).map((f) => [f, str(v[f])])) }),
  // Edits pass the row's id and current active state; new rows start active.
  "gym.challenge": (v: V, a: A = {}) => ({ ...v, type: "challenge", id: a.id, active: a.active ?? true, rewardId: v.rewardId ?? null, beforeHour: v.beforeHour ?? undefined }),
  "gym.milestone": (v: V, a: A = {}) => ({ ...v, type: "milestone", id: a.id, active: a.active ?? true, rewardId: v.rewardId ?? null }),
  "gym.reward": (v: V, a: A = {}) => ({ ...v, type: "reward", id: a.id, active: a.active ?? true, value: Number(v.value ?? 0) }),
  "gym.announcement": (v: V, a: A = {}) => ({
    title: v.title, body: v.body, audience: v.audience, expiresAt: v.expiresAt ? gymDay(v.expiresAt, "23:59:59", a) : null,
    ...(a.edit ? {} : { publish: !!v.publish }),
  }),
  "gym.engagementRules": (v: V) => ({ settings: { engagement: { streakRestDays: Number(v.streakRestDays) } } }),
  // ── growth: public page, offers, enquiries ──
  "gym.publicPage": (v: V) => ({
    settings: {
      publicPage: {
        enabled: !!v.enabled, allowSelfSignup: !!v.allowSelfSignup, listInDirectory: !!v.listInDirectory, showPrices: !!v.showPrices,
        tagline: opt(v.tagline), about: opt(v.about), openingHours: opt(v.openingHours), amenities: Array.isArray(v.amenities) ? v.amenities : [],
      },
    },
  }),
  "gym.referral": (v: V) => ({ settings: { growth: { referralReward: opt(v.referralReward) } } }),
  "gym.promotion": (v: V, a: A = {}) => ({
    title: v.title, description: v.description ?? null, badge: v.badge ?? null, couponId: v.couponId || null, planId: v.planId || null,
    startsAt: v.startsAt ? gymDay(v.startsAt, "00:00:00", a) : null, endsAt: v.endsAt ? gymDay(v.endsAt, "23:59:59", a) : null,
    active: !!v.active, showOnPublicPage: !!v.showOnPublicPage,
  }),
  // "Valid until" a day means through the end of that day in the gym's timezone.
  "gym.coupon": (v: V, a: A = {}) => ({ ...v, validUntil: v.validUntil ? gymDay(v.validUntil, "23:59:59", a) : null }),
  "gym.lead": (v: V) => ({ ...v, email: v.email || null, preferredVisitOn: v.preferredVisitOn ? str(v.preferredVisitOn).slice(0, 10) : null }),
  // ── diet plans ──
  "gym.dietTemplate": (v: V, a: A = {}) => (a.edit ? dietPlan(v) : { kind: "template", plan: dietPlan(v) }),
  "gym.dietAssign": (v: V) => (v.templateId ? { kind: "assign", memberId: v.memberId, templateId: v.templateId } : { kind: "assign", memberId: v.memberId, plan: dietPlan({ ...v, title: v.title || "My diet plan" }) }),
  "gym.automation": (v: V, a: A) => ({
    op: "override", key: a.key, enabled: !!v.enabled, delayMinutes: Math.max(0, Math.round(Number(v.delayHours ?? 0) * 60)),
    minDaysInactive: v.minDaysInactive ? Number(v.minDaysInactive) : null, channels: channels(v),
  }),
  "gym.staffPermissions": (v: V, a: A) => {
    const grantable = a.grantable as string[];
    const role = v.role as "MANAGER" | "STAFF" | "TRAINER";
    const defaults = effectivePermissions({ role, grantedPermissions: [], revokedPermissions: [] }) as Set<string>;
    const on = grantable.filter((p) => v[`p_${p}`]);
    return { role, grantedPermissions: on.filter((p) => !defaults.has(p)), revokedPermissions: grantable.filter((p) => defaults.has(p) && !on.includes(p)) };
  },
  "gym.booking": (v: V) => ({ ...v, scheduledAt: v.scheduledAt ?? undefined, trainerId: v.trainerId ?? undefined }),
  "gym.manualPayment": (v: V, a: A) => ({ ...v, memberId: a.memberId, amountRupees: v.amountRupees ?? undefined, note: v.note ?? undefined }),
  "gym.product": (v: V) => ({ ...v, featured: !!v.featured }),
  "gym.bundle": (v: V) => ({
    name: v.name, description: v.description ?? null, categoryId: v.categoryId, priceRupees: v.priceRupees, featured: !!v.featured,
    items: Object.keys(v).filter((k) => k.startsWith("i_") && v[k]).map((k) => ({ productId: k.slice(2), quantity: 1 })),
  }),
  "vendor.product": (v: V) => ({ inventory: v.inventory ?? undefined, priceRupees: v.priceRupees ?? undefined }),

  // ── control center ──
  "admin.gymAction": (v: V, a: A) => ({ action: a.action, reason: v.reason }),
  "admin.ticketReply": (v: V) => ({ body: v.body, internal: !!v.internal }),
  "admin.announcement": (v: V, a: A) => ({
    title: v.title, body: v.body, target: v.target, planId: v.planId, gymId: v.gymId,
    roles: (a.roles as string[]).filter((r) => v[`r_${r}`]), publishAt: v.publishAt, expiresAt: v.expiresAt, publishNow: !!v.publishNow,
  }),
  "admin.content": (v: V) => {
    const data = parseJsonOr(v.data);
    return { section: v.section, key: v.key, title: v.title, locale: v.locale ?? "en", data: typeof data === "object" && data ? data : { body: str(v.data) } };
  },
  "admin.notificationProvider": (v: V, a: A) => ({ key: a.key, enabled: !!v.enabled, dailyLimit: v.dailyLimit ?? null, credentials: Object.fromEntries((a.fields as string[]).map((f) => [f, str(v[f])])) }),
  "admin.template": (v: V, a: A) => ({ ...v, key: a.key }),
  "admin.operation": (v: V, a: A) => ({ op: a.op, gymId: v.gymId ?? undefined, targetId: v.targetId ?? undefined }),
  "admin.platformSetting": (v: V, a: A) => ({ key: a.key, value: parseJsonOr(v.value) }),
  "admin.security": (v: V, a: A) => ({ action: a.action, target: a.target, email: v.email }),
  "admin.paymentProvider": (v: V, a: A) => ({
    key: a.key, enabled: !!v.enabled, environment: v.environment,
    methods: str(v.methods).split(",").map((s) => s.trim()).filter(Boolean),
    credentials: Object.fromEntries((a.fields as string[]).map((f) => [f, str(v[f])])),
  }),
  "admin.automation": (v: V, a: A) => {
    const body: V = {
      ...Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("ch_") && k !== "minDaysInactive" && k !== "template")),
      delayMinutes: Number(v.delayMinutes ?? 0),
      priority: Number(v.priority ?? 0),
      enabled: !!v.enabled,
      conditions: v.minDaysInactive ? { minDaysInactive: Number(v.minDaysInactive) } : {},
      actionConfig: { ...(v.template ? { template: v.template } : {}), channels: channels(v) },
    };
    if (a.edit) delete body.key;
    return body;
  },
  "admin.commission": (v: V) => ({
    name: v.name, scope: v.scope, categoryId: v.categoryId, vendorId: v.vendorId, gymId: v.gymId, validFrom: v.validFrom, validUntil: v.validUntil,
    platformBps: Math.round(Number(v.platform) * 100), gymBps: Math.round(Number(v.gym) * 100), vendorBps: Math.round(Number(v.vendor) * 100),
    priority: Number(v.priority ?? 0), active: true,
  }),
  "admin.category": (v: V) => ({ ...v, sortOrder: Number(v.sortOrder ?? 0), active: true }),
  "admin.promotion": (v: V) => ({ ...v, active: !!v.active, sortOrder: Number(v.sortOrder ?? 0) }),
  "admin.platformCoupon": (v: V) => ({ ...v, active: true, value: Number(v.value) }),
  "admin.predictionRules": (v: V) => ({
    ...Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("w_") && !k.startsWith("l_"))),
    nonExpiringChurnShare: Number(v.nonExpiringChurnShare),
    weights: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, Number(v[`w_${k}`])])),
    labels: Object.fromEntries(Object.keys(DEFAULT_LABELS).map((k) => [k, str(v[`l_${k}`])])),
  }),
} satisfies Record<string, (v: V, a: A) => unknown>;

export type TransformKey = keyof typeof TRANSFORMS;
