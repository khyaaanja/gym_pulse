type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  return order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
}

// Keys whose values must never reach logs.
const REDACT = /pass(word)?|secret|token|authorization|cookie|credential|signature|otp|mfa/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact(meta) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (level === "error") void reportError(msg, meta);
}

/**
 * Error-monitoring hook: POSTs to ERROR_WEBHOOK_URL when configured. The body works with Slack (`text`) and Discord
 * (`content`) incoming webhooks, which reject anything without those fields, and keeps the structured fields
 * (`msg`, `meta`, `env`, `at`) for relays that parse JSON.
 */
export async function reportError(msg: string, meta?: Record<string, unknown>) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const env = process.env.APP_ENV;
  const safeMeta = redact(meta);
  const requestId = typeof meta?.requestId === "string" ? ` (request ${meta.requestId})` : "";
  const summary = `[GymPulse ${env ?? "unknown"}] ${msg}${requestId}`.slice(0, 1900); // Discord caps content at 2000
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: summary, content: summary, msg, meta: safeMeta, env, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
    // console, not log.error: a failing webhook must not report itself in a loop.
    if (!res.ok) console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", msg: "error_webhook.rejected", status: res.status }));
  } catch {
    // monitoring must never break the request path
  }
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};
