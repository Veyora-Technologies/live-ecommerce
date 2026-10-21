import { loadEnvConfig } from "@next/env";

// These scripts write synthetic/demo records; load the project env before checking
// the safeguards so a local .env file behaves consistently with CI.
loadEnvConfig(process.cwd());

export function assertDemoSeedAllowed(seedName: string): void {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const allowed = process.env.LIVE_ALLOW_DEMO_SEED === "1";
  const isDemo = process.env.LIVE_DATA_MODE === "demo";
  const isLocalSqlite = /^file:/i.test(databaseUrl);
  const isProductionRuntime = process.env.NODE_ENV === "production";

  if (!allowed || !isDemo || !isLocalSqlite || isProductionRuntime) {
    throw new Error(
      `Refusing ${seedName}: synthetic seed scripts require LIVE_DATA_MODE=demo, ` +
      "LIVE_ALLOW_DEMO_SEED=1, a file: SQLite DATABASE_URL, and a non-production runtime. " +
      "Never run demo seeds against valuable or production data."
    );
  }
}

export function readDemoPasswords(): { userPassword: string; adminPassword: string } {
  const userPassword = process.env.LIVE_DEMO_USER_PASSWORD ?? "";
  const adminPassword = process.env.LIVE_DEMO_ADMIN_PASSWORD ?? "";
  for (const [name, password] of [
    ["LIVE_DEMO_USER_PASSWORD", userPassword],
    ["LIVE_DEMO_ADMIN_PASSWORD", adminPassword],
  ] as const) {
    if (password.length < 16 || password.length > 72) {
      throw new Error(`${name} must be set to a random 16–72 character demo-only password before seeding.`);
    }
  }
  return { userPassword, adminPassword };
}
