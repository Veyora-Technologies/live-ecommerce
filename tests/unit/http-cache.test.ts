import { describe, expect, it } from "vitest";
import { CACHE_POLICIES, isPersonalisedRequest, noStoreHeaders, publicCache } from "@/lib/http-cache";

/**
 * Cache-safety tests.
 *
 * The only failure that matters here is a shared cache handing one person's
 * response to another, so every assertion is about *refusing* to be public when
 * the request could be personalised.
 */

const headersWith = (cookie?: string) =>
  ({ headers: new Headers(cookie ? { cookie } : {}) }) as { headers: Headers };

describe("isPersonalisedRequest", () => {
  it("is false with no cookie header", () => {
    expect(isPersonalisedRequest(headersWith())).toBe(false);
  });

  it("detects the session cookie anywhere in the header", () => {
    expect(isPersonalisedRequest(headersWith("live_token=abc.def.ghi"))).toBe(true);
    expect(isPersonalisedRequest(headersWith("live_theme=dark; live_token=abc"))).toBe(true);
  });

  it("is not fooled by a cookie whose name merely contains the auth name", () => {
    expect(isPersonalisedRequest(headersWith("not_live_token=abc"))).toBe(false);
  });
});

describe("publicCache", () => {
  it("marks an anonymous request shareable", () => {
    const headers = publicCache(CACHE_POLICIES.marketplaceReference, headersWith());
    expect(headers["Cache-Control"]).toContain("public");
    expect(headers["Cache-Control"]).toContain("s-maxage=300");
    expect(headers["Cache-Control"]).toContain("stale-while-revalidate");
  });

  it("refuses to be public when the request carried a session", () => {
    const headers = publicCache(CACHE_POLICIES.marketplaceReference, headersWith("live_token=abc"));
    expect(headers["Cache-Control"]).not.toContain("public");
    expect(headers["Cache-Control"]).toContain("no-store");
  });

  it("degrades to no-store when the caller forgot to pass the request", () => {
    // Without a request we cannot prove anonymity, so the safe branch wins.
    const headers = publicCache(CACHE_POLICIES.geographyReference);
    expect(headers["Cache-Control"]).toContain("no-store");
  });

  it("never emits a positive max-age for a personalised request", () => {
    const headers = publicCache(CACHE_POLICIES.geographyReference, headersWith("live_token=x"));
    expect(headers["Cache-Control"]).not.toMatch(/max-age=[1-9]/);
  });
});

describe("noStoreHeaders", () => {
  it("is private and non-zero-free", () => {
    const headers = noStoreHeaders();
    expect(headers["Cache-Control"]).toContain("private");
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Cache-Control"]).toContain("max-age=0");
  });
});

describe("policy table", () => {
  it("defines a positive TTL and a longer revalidation window for each policy", () => {
    for (const [name, policy] of Object.entries(CACHE_POLICIES)) {
      expect(policy.maxAge, name).toBeGreaterThan(0);
      expect(policy.staleWhileRevalidate, name).toBeGreaterThanOrEqual(policy.maxAge);
    }
  });

  it("keeps reference data TTLs short enough to stay truthful", () => {
    // Categories and market metadata can change during the day; an hour of
    // staleness on them would misrepresent what a merchant can actually sell.
    expect(CACHE_POLICIES.marketplaceReference.maxAge).toBeLessThanOrEqual(600);
    expect(CACHE_POLICIES.marketReference.maxAge).toBeLessThanOrEqual(600);
  });
});
