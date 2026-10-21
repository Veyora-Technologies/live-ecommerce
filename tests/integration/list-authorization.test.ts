import { beforeAll, describe, expect, it } from "vitest";
import { liveIntegrationBase, liveIntegrationEnabled } from "../helpers/integration-environment";
import { assertDemoCredentialsConfigured, demoUserPassword } from "../helpers/demo-credentials";

const BASE = liveIntegrationBase();
const RUN = liveIntegrationEnabled();
const d = RUN ? describe : describe.skip;

async function login(emailOrPhone: string, password: string) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrPhone, password }),
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const token = setCookie.match(/(?:^|,\s*)live_token=([^;]+)/)?.[1];
  if (!token) {
    const body = await response.clone().json().catch(() => ({}));
    throw new Error(`Demo login failed with HTTP ${response.status}: ${body.error || "session cookie missing"}`);
  }
  return `live_token=${token}`;
}

d("Shopping-list authorization integration (requires seeded local accounts and a running server)", () => {
  let ownerCookie = "";
  let otherCookie = "";

  beforeAll(async () => {
    assertDemoCredentialsConfigured();
    const health = await fetch(`${BASE}/api/v1/health`);
    expect(health.status).toBe(200);
    ownerCookie = await login("amina@example.com", demoUserPassword);
    otherCookie = await login("emeka@example.com", demoUserPassword);
  });

  it("keeps list reads and mutations scoped to the owner or invited members", async () => {
    const create = await fetch(`${BASE}/api/lists`, {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Auth test ${Date.now()}`, description: "Private regression fixture", spendingLimit: "" }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    const listId = created.list.id as string;
    expect(created.list).not.toHaveProperty("inviteToken");

    const add = await fetch(`${BASE}/api/lists/${listId}`, {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ customName: "Private fixture item", quantity: 1 }),
    });
    expect(add.status).toBe(201);
    const itemId = (await add.json()).item.id as string;

    const anonymousRead = await fetch(`${BASE}/api/lists/${listId}`);
    expect(anonymousRead.status).toBe(401);

    const outsiderRead = await fetch(`${BASE}/api/lists/${listId}`, { headers: { Cookie: otherCookie } });
    expect(outsiderRead.status).toBe(404);
    const outsiderListPatch = await fetch(`${BASE}/api/lists/${listId}`, {
      method: "PATCH",
      headers: { Cookie: otherCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unauthorized edit" }),
    });
    expect(outsiderListPatch.status).toBe(404);
    const outsiderItemPatch = await fetch(`${BASE}/api/lists/${listId}`, {
      method: "PATCH",
      headers: { Cookie: otherCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, checked: true }),
    });
    expect(outsiderItemPatch.status).toBe(404);

    const ownerRead = await fetch(`${BASE}/api/lists/${listId}`, { headers: { Cookie: ownerCookie } });
    expect(ownerRead.status).toBe(200);
    const listData = (await ownerRead.json()).list;
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0].checked).toBe(false);
    expect(listData).not.toHaveProperty("inviteToken");
    expect(JSON.stringify(listData)).not.toContain("passwordHash");
    expect(JSON.stringify(listData)).not.toContain("mfaSecret");

    const remove = await fetch(`${BASE}/api/lists/${listId}`, { method: "DELETE", headers: { Cookie: ownerCookie } });
    expect(remove.status).toBe(200);
  });
});
