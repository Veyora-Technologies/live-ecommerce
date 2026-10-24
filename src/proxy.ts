import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";

/**
 * Next.js 16 proxy protections (§21/§45):
 * - Rate limiting (in-memory per instance; move to Redis for multi-instance)
 * - Trusted-proxy aware client IPs (TRUSTED_PROXY_HOPS); forwarded headers are
 *   only honoured as far as the configured proxy chain makes them trustworthy
 * - Security headers on every response
 * - Request correlation IDs (x-request-id)
 * - Payload-size guard for APIs
 * - CSRF origin check for cookie-authenticated mutations: browsers normally send
 *   Origin on state-changing requests; cross-site mismatches are rejected.
 *   Only /api/jobs/* is exempt because production requires its cron secret;
 *   webhook subscription management remains cookie- and Origin-protected.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

function limit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  let bucketKey = key;
  let bucket = buckets.get(bucketKey);

  if (!bucket || now > bucket.resetAt) {
    if (!bucket && buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      for (const [existingKey, existingBucket] of buckets) {
        if (now > existingBucket.resetAt) buckets.delete(existingKey);
      }
      // Bound memory under high-cardinality/spoofed IP traffic. New identities
      // share a conservative overflow bucket until expired entries can be pruned.
      if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        const category = key.slice(key.lastIndexOf(":") + 1);
        bucketKey = `__overflow__:${category}`;
      }
    }

    bucket = buckets.get(bucketKey);
    if (!bucket || now > bucket.resetAt) {
      const resetAt = now + windowMs;
      buckets.set(bucketKey, { count: 1, resetAt });
      return { ok: true, remaining: max - 1, resetAt };
    }
  }

  bucket.count++;
  return { ok: bucket.count <= max, remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt };
}

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Integration suites can issue more than the live auth budget in one minute.
 * Relax it only for an explicitly opted-in production-build test server using
 * demo mode and a file-backed SQLite fixture; never for production data or an
 * externally hosted database.
 */
function isIsolatedIntegrationServer() {
  return process.env.LIVE_TEST_RELAXED_RATE_LIMITS === "1"
    && process.env.NODE_ENV === "production"
    && process.env.LIVE_DATA_MODE === "demo"
    && process.env.DATABASE_URL?.trim().startsWith("file:") === true;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
  // Next's development runtime needs eval + HMR websockets; these exceptions never ship in production.
  "Content-Security-Policy": `default-src 'self'; img-src 'self' data: https:; media-src 'self'; connect-src 'self'${isDevelopment ? " ws: wss:" : ""}; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  ...(process.env.NODE_ENV === "production" ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } : {}),
};

const CSRF_EXEMPT_PREFIXES = ["/api/jobs/"];
const MAX_BODY_BYTES = 1_000_000; // 1MB (image upload handled separately below)
const MAX_IMAGE_BYTES = 5_000_000;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const inboundRequestId = req.headers.get("x-request-id");
  const requestId = inboundRequestId && /^[A-Za-z0-9._-]{1,64}$/.test(inboundRequestId) ? inboundRequestId : crypto.randomUUID();

  const withHeaders = (res: NextResponse) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.set("x-request-id", requestId);
    return res;
  };

  const configuredMode = process.env.LIVE_DATA_MODE;
  // Fail closed in production unless demo mode is explicitly declared. An
  // unset LIVE_DATA_MODE must not silently behave like a demo deployment.
  const productionDataModeBlocked = process.env.NODE_ENV === "production" && configuredMode !== "demo";
  const isReadinessProbe = pathname === "/api/v1/health" && req.method === "GET";
  if (productionDataModeBlocked && !isReadinessProbe) {
    const message = configuredMode === "production"
      ? "Live is unavailable until production release configuration is approved."
      : "Live is unavailable: LIVE_DATA_MODE must be explicitly set to \"demo\" in this build.";
    if (pathname.startsWith("/api/")) {
      return withHeaders(NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } }));
    }
    return withHeaders(new NextResponse(message, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    }));
  }

  if (!pathname.startsWith("/api/")) return withHeaders(NextResponse.next());

  // Payload size
  const len = Number(req.headers.get("content-length") || 0);
  const cap = pathname.startsWith("/api/v1/image") ? MAX_IMAGE_BYTES : MAX_BODY_BYTES;
  if (len > cap) return withHeaders(NextResponse.json({ error: "Request too large" }, { status: 413 }));

  // CSRF: cross-site Origin on mutations.
  //
  // Browsers send `Origin` on cross-site form/fetch POSTs, but the header can be
  // absent on some legacy or same-origin navigation cases. `Sec-Fetch-Site` is
  // sent by every modern browser and cannot be set by page script, so it is used
  // as a second, independent signal. Non-browser clients (curl, cron, server-to-
  // server, the integration suite) send neither header and hold no ambient
  // cookie, so they are not blocked by this check.
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !CSRF_EXEMPT_PREFIXES.some(p => pathname.startsWith(p))) {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        const host = req.headers.get("host") || req.nextUrl.host;
        if (originHost !== host) {
          return withHeaders(NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 }));
        }
      } catch { return withHeaders(NextResponse.json({ error: "Invalid origin" }, { status: 403 })); }
    } else {
      const site = req.headers.get("sec-fetch-site");
      if (site === "cross-site") {
        return withHeaders(NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 }));
      }
    }
  }

  const ip = clientIp(req.headers);
  // Without a resolvable, trustworthy client address (e.g. no proxy configured),
  // fall back to a single shared bucket rather than letting a caller mint a new
  // bucket per request by rotating a spoofed header.
  const bucketIdentity = ip ?? "unresolved";
  let category = "api";
  let max = 240;
  if (pathname.startsWith("/api/auth/")) {
    category = "auth";
    max = isIsolatedIntegrationServer() ? 200 : 20;
  } else if (pathname.startsWith("/api/v1/search") || pathname.startsWith("/api/assist")) {
    category = "search";
    max = 120;
  }

  const res = limit(`${bucketIdentity}:${category}`, max);
  if (!res.ok) {
    const retry = Math.max(1, Math.ceil((res.resetAt - Date.now()) / 1000));
    return withHeaders(NextResponse.json(
      { error: "Too many requests", detail: "Please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(retry), "X-RateLimit-Limit": String(max), "X-RateLimit-Remaining": "0" } }
    ));
  }
  const next = NextResponse.next({ request: { headers: new Headers({ ...Object.fromEntries(req.headers), "x-request-id": requestId }) } });
  next.headers.set("X-RateLimit-Limit", String(max));
  next.headers.set("X-RateLimit-Remaining", String(res.remaining));
  return withHeaders(next);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
