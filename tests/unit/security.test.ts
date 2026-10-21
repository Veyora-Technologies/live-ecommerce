import { describe, it, expect, vi } from "vitest";
import { assertSafeOutboundUrl, sha256, hashIp, redact } from "@/lib/security";
import { policyForCategory, availabilityConfidence } from "@/lib/confidence";
import { evaluateHours } from "@/lib/utils";
import { registerSchema, reservationSchema, resetSchema } from "@/lib/validate";

describe("SSRF guard (§20)", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1:3000/admin",
    "http://10.0.0.5/hook",
    "http://192.168.1.1/hook",
    "http://localhost/hook",
    "http://[::1]/hook",
    "http://[::ffff:127.0.0.1]/hook",
    "http://100.64.0.1/hook",
    "http://2130706433/hook",
    "https://user:pass@hooks.example.com/live",
    "http://[fc00::1]/hook",
    "http://[fe80::1]/hook",
    "http://[2001:db8::1]/hook",
    "gopher://example.com",
  ])("blocks %s", (url) => expect(() => assertSafeOutboundUrl(url)).toThrow());
  it("allows public https", () => expect(assertSafeOutboundUrl("https://hooks.example.com/live").hostname).toBe("hooks.example.com"));
});

describe("Token hashing + redaction", () => {
  it("hashes deterministically", () => expect(sha256("abc")).toBe(sha256("abc")));
  it("does not substitute a hardcoded salt when the server secret is unavailable", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(hashIp("203.0.113.7")).toBeNull();
    vi.unstubAllEnvs();
  });
  it("redacts secrets", () => {
    const out = redact({ password: "x", nested:{ token: "y", ok: 1 } });
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.token).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
  });
});

describe("Freshness policies (§1)", () => {
  it("pharmacy is stricter than essentials", () => {
    expect(policyForCategory("Pharmacy").staleAfterHours).toBeLessThan(policyForCategory("Essentials").staleAfterHours);
  });
  it("20h-old pharmacy listing is stale, grocery is not", () => {
    const old = new Date(Date.now() - 20 * 3600000);
    const ph = availabilityConfidence({ availability: "IN_STOCK", category: "Pharmacy", stockQuantity: 5, lastConfirmedAt: old });
    const gr = availabilityConfidence({ availability: "IN_STOCK", category: "Grocery", stockQuantity: 5, lastConfirmedAt: old });
    expect(ph.label).not.toBe("Merchant reported");
    expect(gr.label).toBe("Merchant reported");
  });
});

describe("Operating hours (§30)", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 21, h - 1, m)); // Lagos = UTC+1
  it("24 hours is always open", () => expect(evaluateHours("24 hours", null, null, "Africa/Lagos", at(3)).label).toBe("OPEN_NOW"));
  it("overnight range open at 23:30", () => expect(evaluateHours("08:00-00:30", null, null, "Africa/Lagos", at(23, 30)).label).toBe("OPEN_NOW"));
  it("overnight range closed at 02:00", () => expect(evaluateHours("08:00-00:30", null, null, "Africa/Lagos", at(2)).label).toBe("CLOSED"));
  it("unknown range never claims open", () => expect(evaluateHours("Mon–Fri mornings", null, null, "Africa/Lagos", at(10)).label).toBe("UNKNOWN"));
});

describe("Input schemas (§21)", () => {
  it("rejects short registration passwords", () => expect(registerSchema.safeParse({ name: "Ada Lovelace", email: "a@b.co", password: "short" }).success).toBe(false));
  it("accepts 10+ char passwords", () => expect(registerSchema.safeParse({ name: "Ada Lovelace", email: "a@b.co", password: "long-enough-1" }).success).toBe(true));
  it("bounds reservation quantity", () => expect(reservationSchema.safeParse({ productId: "x", quantity: 500 }).success).toBe(false));
  it("rejects empty reset token", () => expect(resetSchema.safeParse({ token: "", newPassword: "long-enough-1" }).success).toBe(false));
});
