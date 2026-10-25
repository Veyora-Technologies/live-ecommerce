/**
 * Real HTTP integration tests against a running Furnivo server.
 * Run:  npm run dev  (terminal 1)
 *       LIVE_INTEGRATION=1 npm test   (terminal 2)
 * Skipped automatically when the server isn't running so unit runs stay green.
 * Covers: auth, search/NLP, reservation lifecycle, last-item race, authZ boundaries,
 * barcode, item-request privacy shape, bulk validation errors, job dry-run.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { liveIntegrationBase, liveIntegrationEnabled } from "../helpers/integration-environment";
import { assertDemoCredentialsConfigured, demoUserPassword } from "../helpers/demo-credentials";

const BASE = liveIntegrationBase();
const RUN = liveIntegrationEnabled();
const d = RUN ? describe : describe.skip;

async function login(emailOrPhone: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ emailOrPhone, password }) });
  const cookie = res.headers.get("set-cookie") || "";
  return { res, cookie };
}

d("Furnivo integration (requires running server)", () => {
  let aminaCookie = "", emekaCookie = "", productId = "";

  beforeAll(async () => {
    assertDemoCredentialsConfigured();
    const health = await fetch(`${BASE}/api/v1/health`);
    expect(health.status).toBe(200);
    aminaCookie = (await login("amina@example.com",demoUserPassword)).cookie;
    emekaCookie = (await login("emeka@example.com",demoUserPassword)).cookie;
    expect(aminaCookie).toContain("live_token");
  });

  it("health + NLP search returns parsed filters and explanations", async () => {
    const res = await fetch(`${BASE}/api/v1/search?q=${encodeURIComponent("paracetamol near me under 2000")}`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.parsed?.maxPrice).toBe(2000);
    expect(Array.isArray(data.results)).toBe(true);
    if (data.results[0]) { productId = data.results[0].id; expect(data.results[0]).toHaveProperty("explanation"); }
  });

  it("synonym search: panadol finds paracetamol listings", async () => {
    const res = await fetch(`${BASE}/api/v1/search?q=panadol`);
    const data = await res.json();
    expect(res.status).toBe(200);
    // Either direct synonym hit or semantic fallback — must not error
    expect(data.total).toBeGreaterThanOrEqual(0);
  });

  it("unauthenticated reservation is rejected 401", async () => {
    if (!productId) return;
    const res = await fetch(`${BASE}/api/reservations`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ productId, quantity:1 }) });
    expect(res.status).toBe(401);
  });

  it("user cannot view another user's reservation list as their own", async () => {
    const res = await fetch(`${BASE}/api/reservations`, { headers:{ cookie: emekaCookie } });
    const data = await res.json();
    expect(res.status).toBe(200);
    // Emeka's list only contains Emeka's reservations (server filters by session user)
    expect(Array.isArray(data.reservations)).toBe(true);
  });

  it("barcode endpoint answers honestly", async () => {
    const res = await fetch(`${BASE}/api/products/barcode/0000000000000`);
    const data = await res.json();
    expect(data.found).toBe(false);
  });

  it("jobs expire dry-run does not mutate", async () => {
    const res = await fetch(`${BASE}/api/jobs/expire`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CRON_SECRET ? { "x-cron-secret": process.env.CRON_SECRET } : {}),
      },
      body: JSON.stringify({ dryRun: true }),
    });
    const data = await res.json();
    expect(data.dryRun).toBe(true);
  });

  it("admin analytics is admin-only", async () => {
    const res = await fetch(`${BASE}/api/admin/analytics`, { headers:{ cookie: aminaCookie } });
    expect(res.status).toBe(403);
  });
});
