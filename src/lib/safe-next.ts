/**
 * A `?next=` path that is safe to redirect to: same-site and relative. Browsers strip tab/CR/LF from URLs, so
 * "/\t/evil.example" would become "//evil.example"; any control character or backslash is therefore refused, and
 * the result must still resolve to our own origin.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 300 || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next) || next.startsWith("//")) return null;
  try {
    const base = "http://gympulse.invalid";
    return new URL(next, base).origin === base ? next : null;
  } catch {
    return null;
  }
}
