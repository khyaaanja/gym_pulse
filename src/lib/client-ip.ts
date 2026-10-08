/**
 * The caller's IP address, for rate limits and audit records.
 *
 * X-Forwarded-For is a list the client can start with anything it likes; each proxy appends the address it received
 * the request from. Only entries added by our own proxies can be trusted, so the client IP is the one
 * TRUSTED_PROXY_HOPS entries from the right (default 1: one reverse proxy such as nginx, Caddy or a platform edge).
 * Taking the leftmost entry, as this code once did, let anyone pick their own IP and step around every per-IP limit.
 *
 * With no proxy in front, `next start` only fills in the header when the client didn't send one, so the address
 * can't be trusted at all — production refuses to start without a proxy (see config/env.ts). Limits that must hold
 * regardless are keyed on the account, token or link instead.
 */
export function clientIp(headers: Headers): string | null {
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);
  return entries[Math.max(0, entries.length - hops)]!;
}
