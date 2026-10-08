import nodemailer from "nodemailer";
import { prisma } from "@/db/client";
import { decryptJson } from "@/lib/crypto";
import { log } from "@/lib/logger";
import type { Channel } from "@/generated/prisma/enums";
import { escapeHtml } from "./templates";
import { pushConfigured } from "./push";

export type SendInput = { to: string; subject: string; body: string };
export type SendResult = { providerMessageId?: string };

export class NotConfigured extends Error {}
/** Provider rejected the message for a reason retrying won't fix (bad number, auth). */
export class PermanentSendError extends Error {
  permanent = true;
}

type Adapter = { key: string; send: (input: SendInput, creds: Record<string, string>) => Promise<SendResult> };

async function postForm(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (res.status >= 400 && res.status < 500) throw new PermanentSendError(`Provider rejected message (${res.status}): ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error(`Provider error ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

const ADAPTERS: Record<string, Adapter> = {
  // Sparrow SMS (Nepal) — https://docs.sparrowsms.com
  sparrow: {
    key: "sparrow",
    async send({ to, body }, creds) {
      const text = await postForm("https://api.sparrowsms.com/v2/sms/", { token: creds.token!, from: creds.from!, to, text: body });
      return { providerMessageId: (JSON.parse(text) as { response_code?: number; id?: string }).id };
    },
  },
  // Aakash SMS (Nepal)
  aakash: {
    key: "aakash",
    async send({ to, body }, creds) {
      const text = await postForm("https://sms.aakashsms.com/sms/v3/send", { auth_token: creds.authToken!, to, text: body });
      return { providerMessageId: text.slice(0, 60) };
    },
  },
  // WhatsApp Business Cloud API. Business-initiated messages outside the 24h window need approved templates.
  meta_whatsapp: {
    key: "meta_whatsapp",
    async send({ to, body }, creds) {
      const res = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: `977${to}`, type: "text", text: { body } }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
      if (res.status >= 400 && res.status < 500) throw new PermanentSendError(json.error?.message ?? `WhatsApp rejected (${res.status})`);
      if (!res.ok) throw new Error(json.error?.message ?? `WhatsApp error ${res.status}`);
      return { providerMessageId: json.messages?.[0]?.id };
    },
  },
  smtp: {
    key: "smtp",
    async send({ to, subject, body }, creds) {
      const transport = nodemailer.createTransport(creds.url!);
      const info = await transport.sendMail({
        from: creds.from ?? process.env.EMAIL_FROM,
        to,
        subject,
        text: body,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`,
      });
      return { providerMessageId: info.messageId };
    },
  },
};

/** Development-only email transport: prints the message to the server log. Refused in production by env validation. */
const consoleEmail: Adapter = {
  key: "console",
  async send({ to, subject, body }) {
    log.info("email.console_transport", { to, subject, body });
    return { providerMessageId: `console-${Date.now()}` };
  },
};

export async function adapterFor(channel: Channel): Promise<{ adapter: Adapter; creds: Record<string, string> }> {
  const cfg = await prisma.notificationProviderConfig.findFirst({ where: { channel, enabled: true }, orderBy: { updatedAt: "desc" } });
  if (cfg) {
    const adapter = ADAPTERS[cfg.providerKey];
    if (!adapter) throw new NotConfigured(`Unknown provider ${cfg.providerKey}`);
    return { adapter, creds: decryptJson(cfg.credentialsEnc) ?? {} };
  }
  if (channel === "EMAIL") {
    if (process.env.EMAIL_TRANSPORT === "smtp" && process.env.SMTP_URL) return { adapter: ADAPTERS.smtp!, creds: { url: process.env.SMTP_URL } };
    if (process.env.EMAIL_TRANSPORT === "console" && process.env.APP_ENV !== "production") return { adapter: consoleEmail, creds: {} };
  }
  throw new NotConfigured(`${channel} provider not configured`);
}

export async function channelConfigured(channel: Channel): Promise<boolean> {
  if (channel === "IN_APP") return true;
  if (channel === "PUSH") return pushConfigured();
  try {
    await adapterFor(channel);
    return true;
  } catch {
    return false;
  }
}

export const PROVIDER_CATALOG = [
  { channel: "SMS", key: "sparrow", name: "Sparrow SMS", fields: ["token", "from"] },
  { channel: "SMS", key: "aakash", name: "Aakash SMS", fields: ["authToken"] },
  { channel: "EMAIL", key: "smtp", name: "SMTP", fields: ["url", "from"] },
  { channel: "WHATSAPP", key: "meta_whatsapp", name: "WhatsApp Cloud API", fields: ["accessToken", "phoneNumberId"] },
] as const;
