import { afterEach, describe, expect, it } from "vitest";
import { assertDemoSeedAllowed, readDemoPasswords } from "../../prisma/seed-safety";

const names = [
  "LIVE_DATA_MODE",
  "LIVE_ALLOW_DEMO_SEED",
  "DATABASE_URL",
  "NODE_ENV",
  "LIVE_DEMO_USER_PASSWORD",
  "LIVE_DEMO_ADMIN_PASSWORD",
] as const;
const previous = new Map<string, string | undefined>();
const env = process.env as Record<string, string | undefined>;

function setEnv(values: Record<(typeof names)[number], string | undefined>) {
  for (const name of names) {
    if (!previous.has(name)) previous.set(name, env[name]);
    const value = values[name];
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
}

afterEach(() => {
  for (const [name, value] of previous) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  previous.clear();
});

describe("demo seed safety guard", () => {
  it("allows only explicit demo opt-in on a file-backed database outside production", () => {
    setEnv({ LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "test", LIVE_DEMO_USER_PASSWORD: undefined, LIVE_DEMO_ADMIN_PASSWORD: undefined });
    expect(() => assertDemoSeedAllowed("test fixture")).not.toThrow();
  });

  it.each([
    ["production data mode", { LIVE_DATA_MODE: "production", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "test" }],
    ["missing explicit opt-in", { LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: undefined, DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "test" }],
    ["non-SQLite URL", { LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "postgresql://example.invalid/db", NODE_ENV: "test" }],
    ["production runtime", { LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "production" }],
  ] as const)("refuses %s", (_label, env) => {
    setEnv({ ...env, LIVE_DEMO_USER_PASSWORD: undefined, LIVE_DEMO_ADMIN_PASSWORD: undefined });
    expect(() => assertDemoSeedAllowed("test fixture")).toThrow(/Refusing test fixture/);
  });

  it("requires non-empty random-length demo credentials", () => {
    setEnv({ LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "test", LIVE_DEMO_USER_PASSWORD: "short", LIVE_DEMO_ADMIN_PASSWORD: "another-short" });
    expect(() => readDemoPasswords()).toThrow(/LIVE_DEMO_USER_PASSWORD/);
    setEnv({ LIVE_DATA_MODE: "demo", LIVE_ALLOW_DEMO_SEED: "1", DATABASE_URL: "file:./prisma/ci.db", NODE_ENV: "test", LIVE_DEMO_USER_PASSWORD: "a".repeat(32), LIVE_DEMO_ADMIN_PASSWORD: "b".repeat(32) });
    expect(readDemoPasswords()).toEqual({ userPassword: "a".repeat(32), adminPassword: "b".repeat(32) });
  });
});
