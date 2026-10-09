/**
 * The caller's IP address, for rate limits and audit records.
 *
 * X-Forwarded-For is a list the client can start with anything it likes; each proxy appends the address it received
 * the request from. Only entries added by our own proxies can be trusted, so the client IP is the one
 * TRUSTED_PROXY_HOPS entries from the right (default 1: one reverse proxy such as nginx, Caddy or a platform edge).
 * Taking the leftmost entry, as this code once did, let anyone pick their own IP and step around every per-IP limit.
 *
 * With no proxy in front, `next start` only fills in the header when the client didn't send one, so the address
 * can't be trusted at all: set TRUSTED_PROXY_HOPS=0 there and the header is ignored. Production refuses to start
 * unless TRUSTED_PROXY_HOPS is set explicitly to 1 or more (see config/env.ts). Limits that must hold
 * regardless are keyed on the account, token or link instead.
 */
export function clientIp(headers: Headers): string | null {
  // 0 = no proxy in front (local/LAN use): every entry is client-supplied, so ignore the header entirely.
  // Unset or unparsable falls back to 1; production refuses to start unless it is set explicitly (config/env.ts).
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  const hops = Number.isInteger(raw) && raw >= 0 ? raw : 1;
  if (hops === 0) return null;
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  return entries[Math.max(0, entries.length - hops)]!;
}
