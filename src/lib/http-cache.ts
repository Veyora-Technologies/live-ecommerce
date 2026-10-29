import type { NextRequest } from "next/server";
import { AUTH_COOKIE } from "./auth-cookie";

/**
 * Response caching policy.
 *
 * ## The danger this module is built around
 *
 * A shared cache (CDN, reverse proxy) that stores a response marked `public`
 * will serve it to *everyone*. In an application where the same URL renders
 * differently for a signed-in user — a cart count, a merchant's own drafts, a
 * saved list — one wrong header hands user A's page to user B.
 *
 * So the rule here is inverted from the usual one: **nothing is cacheable
 * unless a caller explicitly names a policy**, and `publicCache()` refuses to
 * co-operate when the request carried a session cookie. The default for every
 * route stays `no-store`.
 *
 * ## What is actually safe to cache
 *
 * Only reference data that is identical for every visitor: marketplace
 * categories, geography, and market metadata. Product prices, stock and
 * availability are deliberately **not** cached — this app's whole proposition is
 * that posted availability is current, and a 60-second stale price on a
 * marketplace listing is a correctness bug, not a performance win.
 */

/**
 * TTLs in seconds. `staleWhileRevalidate` lets the CDN serve a slightly old copy
 * while it refreshes, so a burst of traffic never blocks on the origin.
 */
export type CachePolicy = {
  maxAge: number;
  staleWhileRevalidate: number;
  /** Set when the response must never be stored by a shared cache. */
  visibility?: "public";
};

export const CACHE_POLICIES = {
  /** Categories change when an operator edits them; minutes, not seconds. */
  marketplaceReference: { maxAge: 300, staleWhileRevalidate: 600 },
  /** Country/state/area reference data is effectively static. */
  geographyReference: { maxAge: 3600, staleWhileRevalidate: 86400 },
  /** Market metadata (currency, availability of a market). */
  marketReference: { maxAge: 600, staleWhileRevalidate: 1200 },
} as const satisfies Record<string, CachePolicy>;

/**
 * True when the request carries an authentication cookie.
 *
 * Any response to such a request may be personalised, so it must never be
 * shared. This is intentionally a cookie-name check rather than a full session
 * validation: it runs on the hot path and only needs to answer "could this be
 * someone specific?".
 */
export function isPersonalisedRequest(req: Pick<NextRequest, "headers">): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) return false;
  return cookie.split(";").some((part) => part.trim().startsWith(`${AUTH_COOKIE}=`));
}

/**
 * Build cache headers for a known-public response.
 *
 * If the request was personalised, this degrades to `no-store` rather than
 * trusting the caller. A route that caches reference data can therefore be
 * called by a signed-in user without leaking anything.
 */
export function publicCache(
  policy: CachePolicy,
  req?: Pick<NextRequest, "headers">,
): Record<string, string> {
  // Fail closed: if the caller did not supply the request we cannot prove the
  // response is anonymous, so it must not be shareable. An earlier revision
  // only checked `req && ...`, which silently made a missing argument mean
  // "public" — the exact inversion this module exists to prevent.
  if (!req || isPersonalisedRequest(req)) return noStoreHeaders();

  return {
    "Cache-Control": `public, max-age=${policy.maxAge}, s-maxage=${policy.maxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`,
    // Reference data does not vary on anything but the URL and Accept.
    Vary: "Accept-Encoding",
  };
}

/** The safe default. Every authenticated or user-shaped response uses this. */
export function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
}

/** Shared `noStore` object for routes that spread it into `NextResponse.json`. */
export const NO_STORE = { headers: noStoreHeaders() } as const;
