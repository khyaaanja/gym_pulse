import { prisma } from "@/db/client";
import type { Channel } from "@/generated/prisma/enums";

export const TEMPLATE_KEYS = {
  WELCOME: "Welcome",
  INACTIVITY: "Inactivity nudge",
  RECOVERY: "Recovery message",
  RENEWAL_REMINDER: "Renewal reminder",
  MEMBERSHIP_EXPIRED: "Membership expired",
  PAYMENT_RECEIVED: "Payment received",
  PAYMENT_FAILED: "Payment failed",
  MARKETPLACE_ORDER: "Marketplace order",
  BOOKING_CREATED: "Booking confirmed",
  TRAINER_BOOKING: "Trainer: new booking",
  STAFF_AT_RISK: "Staff: member at risk",
  MILESTONE_REACHED: "Milestone reached",
  PASSWORD_RESET: "Password reset",
  INVITE: "Invitation",
  ANNOUNCEMENT: "Announcement",
} as const;

export type TemplateKey = keyof typeof TEMPLATE_KEYS;

/** Built-in fallbacks so a fresh install always has sensible, non-manipulative copy. */
export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; body: string }> = {
  WELCOME: { subject: "Welcome to {{gymName}}", body: "Hi {{firstName}}, welcome to {{gymName}}! Your membership is ready. Check in with the GymPulse app on your first visit." },
  INACTIVITY: { subject: "We miss you at {{gymName}}", body: "Hi {{firstName}}, it's been {{daysInactive}} days since your last visit to {{gymName}}. Whenever you're ready, we'd love to see you back." },
  RECOVERY: { subject: "Checking in from {{gymName}}", body: "Hi {{firstName}}, this is {{staffName}} from {{gymName}}. We noticed we haven't seen you in a while — is there anything we can help with? Reply anytime." },
  RENEWAL_REMINDER: { subject: "Your membership {{expiryPhrase}}", body: "Hi {{firstName}}, your {{planName}} membership at {{gymName}} {{expiryPhrase}} ({{expiryDate}}). Renew in the app: {{renewLink}}" },
  MEMBERSHIP_EXPIRED: { subject: "Your membership has expired", body: "Hi {{firstName}}, your {{planName}} membership at {{gymName}} expired on {{expiryDate}}. Renew anytime: {{renewLink}}" },
  PAYMENT_RECEIVED: { subject: "Payment received — {{amount}}", body: "Thanks {{firstName}}! We received {{amount}} for {{description}}. Receipt {{receiptNumber}}." },
  PAYMENT_FAILED: { subject: "Payment couldn't be confirmed", body: "Hi {{firstName}}, your payment of {{amount}} for {{description}} couldn't be confirmed. No money was taken by GymPulse. You can try again in the app." },
  MARKETPLACE_ORDER: { subject: "Order {{orderNumber}} confirmed", body: "Hi {{firstName}}, your order {{orderNumber}} ({{amount}}) is confirmed. {{gymName}} will be in touch." },
  BOOKING_CREATED: { subject: "Booking confirmed: {{title}}", body: "Hi {{firstName}}, your booking \"{{title}}\" is confirmed. Your trainer will contact you to schedule." },
  TRAINER_BOOKING: { subject: "New booking: {{title}}", body: "{{memberName}} booked \"{{title}}\" ({{sessions}} session(s)). Please reach out to schedule." },
  STAFF_AT_RISK: { subject: "{{memberName}} may need attention", body: "{{memberName}} hasn't visited in {{daysInactive}} days. Estimated monthly revenue at risk: {{fee}}. Open Pulse to follow up." },
  MILESTONE_REACHED: { subject: "You unlocked {{milestone}}!", body: "Great work {{firstName}} — you reached {{milestone}} at {{gymName}}. Keep it up!" },
  PASSWORD_RESET: { subject: "Reset your GymPulse password", body: "Use this link to reset your password. It expires in 30 minutes: {{link}}. If you didn't ask for this, ignore this message." },
  INVITE: { subject: "You're invited to {{gymName}} on GymPulse", body: "{{inviterName}} invited you to join {{gymName}} on GymPulse as {{role}}. Accept within 7 days: {{link}}" },
  ANNOUNCEMENT: { subject: "{{title}}", body: "{{body}}" },
};

export function render(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Latest PUBLISHED version: the gym's own template first, then the platform default, then built-in copy. */
export async function resolveTemplate(gymId: string | null, key: TemplateKey, channel: Channel) {
  const rows = await prisma.notificationTemplate.findMany({
    where: { key, channel, status: "PUBLISHED", OR: [{ gymId: null }, ...(gymId ? [{ gymId }] : [])] },
    orderBy: { version: "desc" },
  });
  const t = rows.find((r) => r.gymId === gymId && gymId) ?? rows.find((r) => r.gymId === null);
  if (t) return { subject: t.subject ?? DEFAULT_TEMPLATES[key].subject, body: t.body, version: t.version };
  return { ...DEFAULT_TEMPLATES[key], version: 0 };
}
