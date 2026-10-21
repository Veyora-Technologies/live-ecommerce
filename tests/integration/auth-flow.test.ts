import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { liveIntegrationBase, liveIntegrationEnabled } from "../helpers/integration-environment";
import { assertDemoCredentialsConfigured, demoAdminPassword, demoUserPassword } from "../helpers/demo-credentials";

const BASE = liveIntegrationBase();
const RUN = liveIntegrationEnabled();
const d = RUN ? describe : describe.skip;

function tokenCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") || "";
  const token = setCookie.match(/(?:^|,\s*)live_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Login response did not set the session cookie");
  return `live_token=${token}`;
}

d("Authentication HTTP integration (requires seeded local accounts and a running server)", () => {
  let merchantCookie = "";
  let merchantId = "";

  beforeAll(async () => {
    assertDemoCredentialsConfigured({ admin: true });
    const health = await fetch(`${BASE}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBeTruthy();
    const healthData = await health.json();
    expect(healthData).not.toHaveProperty("integrations");
    expect(healthData.version).not.toBe("3.0");
    const merchantLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "owner0@live.ng", password: demoUserPassword }),
    });
    expect(merchantLogin.status).toBe(200);
    expect((await merchantLogin.json()).landingPath).toBe("/merchant");
    merchantCookie = tokenCookie(merchantLogin);
    const merchants = await fetch(`${BASE}/api/merchant`, { headers: { Cookie: merchantCookie } });
    expect(merchants.status).toBe(200);
    merchantId = (await merchants.json()).merchants?.[0]?.id || "";
    expect(merchantId).toBeTruthy();
  });

  it("creates only a consumer account even when registration submits privileged role fields", async () => {
    const email = `registration-${randomUUID()}@integration.invalid`;
    const response = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Integration Consumer",
        email,
        password: "LocalIntegrationPass!248",
        role: "ADMIN",
        isAdmin: true,
        adminRole: "SUPER_ADMIN",
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user?.role).toBe("CONSUMER");
    expect(data.user).not.toHaveProperty("isAdmin");
    expect(data.user).not.toHaveProperty("passwordHash");
    expect(response.headers.get("set-cookie") || "").toContain("live_token=");
  });

  it("does not claim password-reset email was sent when delivery is unavailable", async () => {
    const response = await fetch(`${BASE}/api/auth/forgot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "amina@example.com" }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json();
    expect(data.code).toBe("PASSWORD_RESET_DELIVERY_UNAVAILABLE");
    expect(data.error).toContain("No email was sent");
    expect(data).not.toHaveProperty("devResetToken");
  });

  it("rejects invalid password-reset tokens", async () => {
    const response = await fetch(`${BASE}/api/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not-a-valid-token", newPassword: "LocalIntegrationPass!248" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects invalid credentials without issuing a session", async () => {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "no-such-account@invalid.test", password: "not-a-valid-password" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid email/phone or password" });
    expect(response.headers.get("set-cookie") || "").not.toContain("live_token=");
  });

  it("persists a valid session, keeps credentials out of rendered page data, and logs out with a 303", async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "amina@example.com", password: demoUserPassword }),
    });
    expect(login.status).toBe(200);
    const loginData = await login.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.landingPath).toBe("/");
    const cookie = tokenCookie(login);

    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const meData = await me.json();
    expect(meData.user?.email).toBe("amina@example.com");
    expect(meData.user).not.toHaveProperty("passwordHash");
    expect(meData.user).not.toHaveProperty("mfaSecret");

    const profile = await fetch(`${BASE}/profile`, { headers: { Cookie: cookie } });
    expect(profile.status).toBe(200);
    const markup = await profile.text();
    expect(markup).not.toMatch(/\$2[aby]\$\d{2}\$/);
    expect(markup).not.toContain("mfaSecret");
    expect(markup).not.toContain("passwordHash");

    const logout = await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Accept: "text/html" },
      redirect: "manual",
    });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toMatch(/\/$/);
    expect(logout.headers.get("set-cookie") || "").toMatch(/live_token=.*Max-Age=0/i);

    const afterLogout = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect((await afterLogout.json()).user).toBeNull();
  });

  it("redirects signed-out users away from protected pages", async () => {
    for (const path of ["/profile", "/admin"]) {
      const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/auth/login");
    }
  });

  it("keeps consumer identity out of merchant reservation and appointment surfaces", async () => {
    const dashboard = await fetch(`${BASE}/merchant`, { headers: { Cookie: merchantCookie } });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).not.toContain("Amina Yusuf");

    const reservationsResponse = await fetch(`${BASE}/api/merchant/${merchantId}/reservations`, { headers: { Cookie: merchantCookie } });
    expect(reservationsResponse.status).toBe(200);
    const reservations = (await reservationsResponse.json()).reservations;
    expect(Array.isArray(reservations)).toBe(true);
    for (const reservation of reservations) {
      expect(reservation).not.toHaveProperty("consumer");
      expect(reservation).not.toHaveProperty("consumerId");
      expect(JSON.stringify(reservation)).not.toContain("Amina Yusuf");
    }

    const bookingsResponse = await fetch(`${BASE}/api/merchant/${merchantId}/bookings`, { headers: { Cookie: merchantCookie } });
    expect(bookingsResponse.status).toBe(200);
    const bookings = (await bookingsResponse.json()).bookings;
    expect(Array.isArray(bookings)).toBe(true);
    for (const booking of bookings) {
      expect(booking).not.toHaveProperty("consumer");
      expect(booking).not.toHaveProperty("consumerId");
    }

    if (reservations[0]) {
      const detail = await fetch(`${BASE}/api/reservations/${reservations[0].id}`, { headers: { Cookie: merchantCookie } });
      expect(detail.status).toBe(200);
      const data = await detail.json();
      expect(data.reservation).not.toHaveProperty("consumer");
      expect(data.reservation).not.toHaveProperty("consumerId");
    }

    const consumerLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "amina@example.com", password: demoUserPassword }),
    });
    const consumerCookie = tokenCookie(consumerLogin);
    const forbidden = await fetch(`${BASE}/api/merchant/${merchantId}/reservations`, { headers: { Cookie: consumerCookie } });
    expect(forbidden.status).toBe(403);
  });

  it("routes administrators to the admin workspace and rejects consumer access", async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "admin@live.ng", password: demoAdminPassword }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).landingPath).toBe("/admin");
    const cookie = tokenCookie(login);
    const page = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);

    const consumerLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOrPhone: "amina@example.com", password: demoUserPassword }),
    });
    const consumer = await fetch(`${BASE}/admin`, { headers: { Cookie: tokenCookie(consumerLogin) }, redirect: "manual" });
    expect(consumer.status).toBe(404);
  });
});
