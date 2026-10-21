import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: process.env.LIVE_BASE_URL || "http://localhost:3000", trace: "retain-on-failure" },
  webServer: process.env.LIVE_BASE_URL ? undefined : {
    command: "npm run dev -- --port 3000 --hostname 0.0.0.0",
    url: "http://localhost:3000/api/v1/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
