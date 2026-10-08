import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(name: "DATA_ENCRYPTION_KEY" | "FILE_ENCRYPTION_KEY"): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return buf;
}

/** AES-256-GCM. Output: "v1:" + base64(iv | tag | ciphertext). */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptString(payload: string): string {
  if (!payload.startsWith("v1:")) throw new Error("Unknown ciphertext version");
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  return JSON.parse(decryptString(payload)) as T;
}

/** File encryption at rest. Layout: magic "GPF1" | iv(12) | tag(16) | ciphertext. */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("FILE_ENCRYPTION_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("GPF1"), iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  if (payload.subarray(0, 4).toString() !== "GPF1") throw new Error("Not an encrypted GymPulse file");
  const decipher = createDecipheriv("aes-256-gcm", key("FILE_ENCRYPTION_KEY"), payload.subarray(4, 16));
  decipher.setAuthTag(payload.subarray(16, 32));
  return Buffer.concat([decipher.update(payload.subarray(32)), decipher.final()]);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function hmacSha256(secret: string, value: string, encoding: "hex" | "base64" | "base64url" = "hex") {
  return createHmac("sha256", secret).update(value).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function signingSecret(): string {
  const s = process.env.SIGNING_SECRET;
  if (!s || s.length < 32) throw new Error("SIGNING_SECRET must be at least 32 characters");
  return s;
}

/** Compact signed token: base64url(json).base64url(hmac). */
export function signPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacSha256(signingSecret(), body, "base64url")}`;
}

export function verifyPayload<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmacSha256(signingSecret(), body, "base64url"))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
