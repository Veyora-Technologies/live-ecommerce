import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvStatus } from "@/lib/env";
import { getLegalReleaseGate } from "@/lib/legal";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

function setBlockedProductionConfig() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LIVE_DATA_MODE", "production");
  vi.stubEnv("DATABASE_URL", "file:/tmp/live-production-gate-test.sqlite");
  vi.stubEnv("JWT_SECRET", "unit-test-secret-that-is-long-enough-for-production-check");
}

afterEach(() => vi.unstubAllEnvs());

describe("production data mode release gate", () => {
  it("rejects an unknown data-mode value rather than silently treating it as demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_DATA_MODE", "prod");
    vi.stubEnv("DATABASE_URL", "file:/tmp/live-production-gate-test.sqlite");
    vi.stubEnv("JWT_SECRET", "unit-test-secret-that-is-long-enough-for-production-check");
    const status = getEnvStatus();
    expect(status.valid).toBe(false);
    expect(status.errors).toContain("LIVE_DATA_MODE");
  });

  it("treats an unset data mode in production as invalid instead of defaulting to demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_DATA_MODE", undefined);
    vi.stubEnv("DATABASE_URL", "file:/tmp/live-production-gate-test.sqlite");
    vi.stubEnv("JWT_SECRET", "unit-test-secret-that-is-long-enough-for-production-check");
    const status = getEnvStatus();
    expect(status.valid).toBe(false);
    expect(status.errors).toContain("LIVE_DATA_MODE");
  });

  it("accepts an explicit demo data mode in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_DATA_MODE", "demo");
    vi.stubEnv("DATABASE_URL", "file:/tmp/live-production-gate-test.sqlite");
    vi.stubEnv("JWT_SECRET", "unit-test-secret-that-is-long-enough-for-production-check");
    expect(getEnvStatus().valid).toBe(true);
  });

  it("marks short production JWT secrets as invalid in the health configuration check", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_DATA_MODE", "demo");
    vi.stubEnv("DATABASE_URL", "file:/tmp/live-production-gate-test.sqlite");
    vi.stubEnv("JWT_SECRET", "too-short");
    const status = getEnvStatus();
    expect(status.valid).toBe(false);
    expect(status.errors).toContain("JWT_SECRET");
  });

  it("marks the current SQLite-only production profile as not ready without exposing values", () => {
    setBlockedProductionConfig();
    const status = getEnvStatus();
    expect(status.valid).toBe(false);
    expect(status.errors).toContain("LIVE_DATA_MODE");
    expect(JSON.stringify(status)).not.toContain("unit-test-secret");
  });

  it("blocks legal-gated public features before querying unreviewed production policy records", async () => {
    setBlockedProductionConfig();
    const gate = await getLegalReleaseGate("MARKETPLACE");
    expect(gate.ready).toBe(false);
    expect(gate.bypassedOutsideProduction).toBe(false);
    expect(gate.publicMessage).toContain("production database");
  });

  it("blocks direct operational-market API access with 503 in the unsupported production profile", async () => {
    setBlockedProductionConfig();
    const result = await requireOperationalMarket("NG").catch((error: unknown) => error);
    expect(result).toBeInstanceOf(MarketUnavailableError);
    expect(result).toMatchObject({ status: 503 });
  });
});
