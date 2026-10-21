import { beforeAll, describe, expect, it } from "vitest";
import { liveIntegrationBase, liveIntegrationEnabled } from "../helpers/integration-environment";
import { assertDemoCredentialsConfigured, demoAdminPassword, demoUserPassword } from "../helpers/demo-credentials";

const BASE = liveIntegrationBase();
const RUN = liveIntegrationEnabled();
const d = RUN ? describe : describe.skip;

type ReviewListing = {
  id: string;
  lifecycleStatus?: string;
  moderationStatus?: string;
  transactionMode?: string;
  product: { id: string; stockQuantity?: number; reservedQuantity?: number } | null;
  service: { id: string } | null;
};
type EnquirySummary = { id: string; requesterId?: string };

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function login(emailOrPhone: string, password: string) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrPhone, password }),
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const token = setCookie.match(/(?:^|,\s*)live_token=([^;]+)/)?.[1];
  if (!token) throw new Error(`Login failed for the isolated demo test user (HTTP ${response.status}).`);
  return `live_token=${token}`;
}

d("Live V10 marketplace integration (isolated local demo DB only)", () => {
  let adminCookie = "";
  let ownerCookie = "";
  let consumerCookie = "";

  beforeAll(async () => {
    assertDemoCredentialsConfigured({ admin: true });
    const health = await fetch(`${BASE}/api/v1/health`);
    expect(health.status).toBe(200);
    adminCookie = await login("admin@live.ng", demoAdminPassword);
    ownerCookie = await login("owner0@live.ng", demoUserPassword);
    consumerCookie = await login("amina@example.com", demoUserPassword);
  });

  it("surfaces only ready product and service categories and keeps future categories unavailable", async () => {
    const categoryResponse = await fetch(`${BASE}/api/marketplace/categories`);
    expect(categoryResponse.status).toBe(200);
    const categoryData = await readJson<{ categories: { slug: string }[] }>(categoryResponse);
    const slugs = categoryData.categories.map((category: { slug: string }) => category.slug);
    expect(slugs).toEqual(["products", "services"]);

    const unavailable = await fetch(`${BASE}/api/marketplace/listings?category=vehicles-transport`);
    expect(unavailable.status).toBe(404);
    const forbiddenQueue = await fetch(`${BASE}/api/admin/marketplace/listings`, { headers: { Cookie: consumerCookie } });
    expect(forbiddenQueue.status).toBe(403);
  });

  it("requires listing review, publishes only after an authorized decision, and re-reviews content edits", async () => {
    const merchantResponse = await fetch(`${BASE}/api/merchant`, { headers: { Cookie: ownerCookie } });
    expect(merchantResponse.status).toBe(200);
    const merchantData = await readJson<{ merchants?: { id: string }[] }>(merchantResponse);
    const merchant = merchantData.merchants?.[0];
    if (!merchant) throw new Error("The isolated integration merchant is missing.");

    const productResponse = await fetch(`${BASE}/api/merchant/products?merchantId=${encodeURIComponent(merchant.id)}`, { headers: { Cookie: ownerCookie } });
    expect(productResponse.status).toBe(200);
    const products = (await readJson<{ products: { id: string; name: string; updatedAt: string }[] }>(productResponse)).products;
    expect(products.length).toBeGreaterThan(0);
    const product = products[0];
    if (!product) throw new Error("The isolated integration merchant has no product to review.");

    const queueResponse = await fetch(`${BASE}/api/admin/marketplace/listings`, { headers: { Cookie: adminCookie } });
    expect(queueResponse.status).toBe(200);
    const queue = (await readJson<{ listings: ReviewListing[] }>(queueResponse)).listings;
    const pending = queue.find((listing) => listing.product?.id === product.id);
    if (!pending) throw new Error("The product was not present in the moderation queue.");
    expect(pending.lifecycleStatus).toBe("PENDING_REVIEW");
    expect(pending.moderationStatus).toBe("PENDING");

    const approveResponse = await fetch(`${BASE}/api/admin/marketplace/listings`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: pending.id, action: "approve", reason: "Reviewed in isolated integration test" }),
    });
    expect(approveResponse.status).toBe(200);

    const publicResponse = await fetch(`${BASE}/api/marketplace/listings?category=products&q=${encodeURIComponent(product.name)}`);
    expect(publicResponse.status).toBe(200);
    const publicData = await readJson<{ listings: ReviewListing[] }>(publicResponse);
    const published = publicData.listings.find((listing) => listing.product?.id === product.id);
    if (!published) throw new Error("The approved product was not visible in the public marketplace response.");
    expect(published.lifecycleStatus).toBeUndefined();
    expect(published.product).not.toHaveProperty("stockQuantity");
    expect(published.product).not.toHaveProperty("reservedQuantity");
    expect(JSON.stringify(publicData)).not.toContain("ownerId");

    const enquiryResponse = await fetch(`${BASE}/api/enquiries`, {
      method: "POST",
      headers: { Cookie: consumerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId: merchant.id, productId: product.id, enquiryType: "CONFIRM_STOCK", body: "Could you confirm current availability?" }),
    });
    expect(enquiryResponse.status).toBe(201);
    const enquiryData = await readJson<{ enquiry: { id: string }; contactSharing: string }>(enquiryResponse);
    const enquiryId = enquiryData.enquiry.id;
    expect(enquiryData.contactSharing).toContain("No phone number or address was shared");

    const merchantInboxResponse = await fetch(`${BASE}/api/enquiries`, { headers: { Cookie: ownerCookie } });
    expect(merchantInboxResponse.status).toBe(200);
    const merchantInbox = await readJson<{ enquiries: EnquirySummary[] }>(merchantInboxResponse);
    const merchantEnquiry = merchantInbox.enquiries.find((item) => item.id === enquiryId);
    if (!merchantEnquiry) throw new Error("The merchant could not see the enquiry they received.");
    expect(merchantEnquiry).not.toHaveProperty("requesterId");
    expect(JSON.stringify(merchantEnquiry)).not.toContain("amina@example.com");

    const sellerReply = await fetch(`${BASE}/api/enquiries`, {
      method: "PUT",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enquiryId, body: "Our current record shows availability; please confirm before travelling." }),
    });
    expect(sellerReply.status).toBe(200);
    const sellerThreadResponse = await fetch(`${BASE}/api/enquiries?id=${encodeURIComponent(enquiryId)}`, { headers: { Cookie: ownerCookie } });
    expect(sellerThreadResponse.status).toBe(200);
    const sellerThread = await readJson<{ enquiry: { requesterId?: string }; messages: { authorId?: string; side: string }[] }>(sellerThreadResponse);
    expect(sellerThread.enquiry).not.toHaveProperty("requesterId");
    expect(sellerThread.messages[0]).not.toHaveProperty("authorId");
    expect(sellerThread.messages[0].side).toBe("CONSUMER");

    const reportResponse = await fetch(`${BASE}/api/enquiries`, {
      method: "PATCH",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enquiryId, action: "report", reason: "Integration test verifies report is not auto-blocking" }),
    });
    expect(reportResponse.status).toBe(200);
    expect((await readJson<{ enquiry: { status: string } }>(reportResponse)).enquiry.status).toBe("ANSWERED");

    const closeResponse = await fetch(`${BASE}/api/enquiries`, {
      method: "PATCH",
      headers: { Cookie: consumerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enquiryId, action: "close" }),
    });
    expect(closeResponse.status).toBe(200);
    expect((await readJson<{ enquiry: { status: string } }>(closeResponse)).enquiry.status).toBe("CLOSED");

    const serviceName = `V10 booking workflow ${Date.now()}`;
    const serviceCreateResponse = await fetch(`${BASE}/api/services`, {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId: merchant.id, name: serviceName, description: "Integration-only service listing", price: 125, durationMin: 45, capacity: 1 }),
    });
    expect(serviceCreateResponse.status).toBe(201);
    const service = (await readJson<{ service: { id: string } }>(serviceCreateResponse)).service;
    const serviceQueueResponse = await fetch(`${BASE}/api/admin/marketplace/listings`, { headers: { Cookie: adminCookie } });
    const serviceQueue = (await readJson<{ listings: ReviewListing[] }>(serviceQueueResponse)).listings;
    const pendingService = serviceQueue.find((item) => item.service?.id === service.id);
    if (!pendingService) throw new Error("The service was not present in the moderation queue.");
    expect(pendingService.lifecycleStatus).toBe("PENDING_REVIEW");
    const serviceApproval = await fetch(`${BASE}/api/admin/marketplace/listings`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: pendingService.id, action: "approve", reason: "Reviewed in isolated integration test" }),
    });
    expect(serviceApproval.status).toBe(200);
    const publicServiceResponse = await fetch(`${BASE}/api/marketplace/listings?category=services&q=${encodeURIComponent(serviceName)}`);
    const publicServiceData = await readJson<{ listings: ReviewListing[] }>(publicServiceResponse);
    expect(publicServiceData.listings.some((item) => item.service?.id === service.id && item.transactionMode === "BOOKING_REQUEST")).toBe(true);

    const nextName = `${product.name} Reviewed ${Date.now()}`.slice(0, 160);
    const editResponse = await fetch(`${BASE}/api/merchant/products/${encodeURIComponent(product.id)}`, {
      method: "PATCH",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName, expectedUpdatedAt: new Date(product.updatedAt).toISOString() }),
    });
    expect(editResponse.status).toBe(200);

    const unpublishedResponse = await fetch(`${BASE}/api/marketplace/listings?category=products&q=${encodeURIComponent(nextName)}`);
    expect(unpublishedResponse.status).toBe(200);
    const unpublished = await readJson<{ listings: ReviewListing[] }>(unpublishedResponse);
    expect(unpublished.listings.some((listing) => listing.product?.id === product.id)).toBe(false);

    const rejectWithoutReason = await fetch(`${BASE}/api/admin/marketplace/listings`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: pending.id, action: "reject" }),
    });
    expect(rejectWithoutReason.status).toBe(400);
  });
});
