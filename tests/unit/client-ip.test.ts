import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, trustedProxyHops } from "@/lib/client-ip";

afterEach(() => vi.unstubAllEnvs());

describe("trusted proxy client IP resolution", () => {
  it("ignores a spoofed left-most X-Forwarded-For entry", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    expect(clientIp(headers)).toBe("198.51.100.7");
  });

  it("walks back the configured number of proxy hops", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.5, 198.51.100.7" });
    expect(clientIp(headers)).toBe("203.0.113.5");
  });

  it("does not trust forwarded headers at all when hops is 0", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    expect(clientIp(headers)).toBeNull();
  });

  it("returns null when the chain is shorter than the configured hop count", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    expect(clientIp(headers)).toBeNull();
  });

  it("rejects values that are not IP addresses", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "999.1.1.1" }))).toBeNull();
  });

  it("accepts IPv6 and strips the port", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
  });

  it("falls back to invalid hop configuration rather than trusting headers", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "abc");
    expect(trustedProxyHops()).toBe(0);
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.7" }))).toBeNull();
  });
});
