import { z } from "zod";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be a base64-encoded 32-byte key");

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATA_ENCRYPTION_KEY: base64Key,
  FILE_ENCRYPTION_KEY: base64Key,
  SIGNING_SECRET: z.string().min(32),
  STORAGE_DIR: z.string().default("./.storage"),
  RUN_WORKER_IN_PROCESS: z.enum(["true", "false"]).default("false"),
  ALLOW_ADMIN_WITHOUT_MFA: z.enum(["true", "false"]).default("false"),
  // The test payment gateway lets members approve their own payments. Local development/demo only.
  ENABLE_TEST_GATEWAY: z.enum(["true", "false"]).default("false"),
  // How many reverse proxies sit in front of the app and append to X-Forwarded-For. The client IP is read that many
  // entries from the right; anything further left is client-supplied and ignored. 0 = no proxy: the header is ignored.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  OCR_PROVIDER: z.enum(["tesseract", "none"]).default("none"),
  TESSERACT_LANG_PATH: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(["smtp", "console", "none"]).default("none"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("GymPulse <no-reply@gympulse.local>"),
  // Web Push. Without both keys the PUSH channel reports "not configured" and the UI hides the device toggle.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@gympulse.local"),
  // "Continue with Google". Both must be set, or the button is hidden. Redirect URI: <APP_URL>/api/auth/google/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  ERROR_WEBHOOK_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;
  if (value.APP_ENV === "production") {
    if (value.ALLOW_ADMIN_WITHOUT_MFA === "true") throw new Error("ALLOW_ADMIN_WITHOUT_MFA must be false in production");
    if (value.EMAIL_TRANSPORT === "console") throw new Error("EMAIL_TRANSPORT=console is not allowed in production");
    if (value.ENABLE_TEST_GATEWAY === "true") throw new Error("ENABLE_TEST_GATEWAY must be false in production");
    // The default (1) suits development; in production it must be a deliberate statement about the deployment,
    // or a server exposed without a proxy would trust whatever X-Forwarded-For a client sends.
    if (!process.env.TRUSTED_PROXY_HOPS?.trim()) throw new Error("Set TRUSTED_PROXY_HOPS explicitly in production: the number of reverse proxies in front of the app (1 for a single Caddy/nginx)");
    if (value.TRUSTED_PROXY_HOPS < 1) throw new Error("Run behind a reverse proxy in production (TRUSTED_PROXY_HOPS >= 1): without one, client IPs can be spoofed and per-IP rate limits don't hold");
    if (!value.APP_URL.startsWith("https://")) throw new Error("APP_URL must be https in production");
  }
  cached = value;
  return value;
}

export const isProduction = () => env().APP_ENV === "production";
