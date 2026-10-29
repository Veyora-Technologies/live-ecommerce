/**
 * Trusted-proxy aware client IP extraction.
 *
 * A client can send any value it likes in `X-Forwarded-For`, so the left-most
 * entry is attacker-controlled. Each trusted proxy *appends* the address it
 * saw, which means the correct entry is counted from the right:
 *
 *   spoofed, real-client, proxy-1        (TRUSTED_PROXY_HOPS=2 → "real-client")
 *   spoofed, real-client                 (TRUSTED_PROXY_HOPS=1 → "real-client")
 *
 * Set TRUSTED_PROXY_HOPS to the number of proxies/CDN hops in front of the app
 * (default 1). Set it to 0 when the app is exposed directly to the internet so
 * forwarded headers are ignored entirely.
 *
 * This module must stay dependency-free (no node:net / no Prisma) because it is
 * imported by src/proxy.ts, which runs on the Next.js edge runtime.
 */

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const IPV6_BRACKETED_WITH_PORT = /^\[([^\]]+)\](?::\d{1,5})?$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;

function isPlausibleIp(value: string): boolean {
  if (!value || value.length > 45) return false;
  if (IPV4.test(value)) return value.split(".").every((part) => Number(part) <= 255);
  return value.includes(":") && IPV6.test(value);
}

/** Split an optional `:port` from an address without mangling bare IPv6. */
function normalizeAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const bracketed = value.match(IPV6_BRACKETED_WITH_PORT);
  if (bracketed) return isPlausibleIp(bracketed[1]) ? bracketed[1] : null;
  const v4WithPort = value.match(IPV4_WITH_PORT);
  const candidate = v4WithPort ? v4WithPort[1] : value;
  return isPlausibleIp(candidate) ? candidate : null;
}

/** Number of trusted proxy hops. Returns 0 (do not trust forwarded headers) for anything invalid. */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) return 0;
  return hops;
}

/**
 * Resolve the caller IP from request headers.
 *
 * Returns null when no trustworthy address is available, so callers can decide
 * how to bucket the request. Never returns a client-supplied string that failed
 * basic IP validation.
 */
export function clientIp(headers: Headers): string | null {
  const hops = trustedProxyHops();
  if (hops > 0) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const chain = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
      // The right-most entry is the address added by the closest trusted proxy.
      const index = chain.length - hops;
      if (index >= 0) {
        const resolved = normalizeAddress(chain[index] ?? "");
        if (resolved) return resolved;
      }
      // A chain shorter than the configured hop count means the request did not
      // traverse the expected proxies; fall through rather than trusting a
      // client-controlled value.
    }
  }
  return normalizeAddress(headers.get("x-real-ip") ?? "");
}
