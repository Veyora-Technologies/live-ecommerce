import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { liveIntegrationBase, liveIntegrationEnabled } from "../helpers/integration-environment";
import { syncProductMarketplaceListing } from "@/lib/marketplace";

const BASE = liveIntegrationBase();
const RUN = liveIntegrationEnabled();
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();

function cookieFrom(response: Response) {
  const token = (response.headers.get("set-cookie") || "").match(/(?:^|,\s*)live_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Test login did not issue a session cookie");
  return `live_token=${token}`;
}

async function login(email: string, password: string) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrPhone: email, password }),
  });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function approveFixtureProduct(productId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    await syncProductMarketplaceListing(tx, productId, actorId);
    await tx.marketplaceListing.update({
      where: { productId },
      data: { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, publishedAt: new Date() },
    });
  });
}

d("Planner cart reservation integrity (isolated loopback DB/server only)", () => {
  const runId = randomUUID();
  const password = `${randomBytes(24).toString("base64url")}A1!`;
  const emailA = `cart-a-${runId}@example.invalid`;
  const emailB = `cart-b-${runId}@example.invalid`;
  const sellerEmail = `cart-seller-${runId}@example.invalid`;
  const userIds: string[] = [];
  let merchantId = "";
  let branchId = "";
  let productId = "";
  let variantProductId = "";
  let variantId = "";
  let overflowProductId = "";
  let liveVariantId = "";
  let privateVariantProductId = "";
  let cookieA = "";
  let cookieB = "";
  let sellerCookie = "";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const consumerA = await prisma.user.create({ data: { name: "Temporary cart test A", email: emailA, passwordHash, role: "CONSUMER" } });
    userIds.push(consumerA.id);
    const consumerB = await prisma.user.create({ data: { name: "Temporary cart test B", email: emailB, passwordHash, role: "CONSUMER" } });
    userIds.push(consumerB.id);
    const seller = await prisma.user.create({ data: { name: "Temporary cart test merchant", email: sellerEmail, passwordHash, role: "MERCHANT" } });
    userIds.push(seller.id);

    const merchant = await prisma.merchant.create({
      data: {
        ownerId: seller.id,
        businessName: `Temporary cart test ${runId.slice(0, 8)}`,
        category: "Essentials",
        address: "Temporary test address",
        area: "Test locality",
        phone: "08000000000",
        status: "APPROVED",
        storeStatus: "OPEN",
        pickupAvailable: true,
        deliveryAvailable: true,
      },
    });
    merchantId = merchant.id;
    await prisma.merchantMembership.create({ data: { merchantId, userId: seller.id, role: "OWNER", status: "ACTIVE" } });

    const branch = await prisma.branch.create({
      data: { merchantId, name: "Temporary pickup branch", address: "Temporary test address", area: "Test locality", storeStatus: "OPEN" },
    });
    branchId = branch.id;
    const product = await prisma.product.create({
      data: {
        merchantId,
        branchId,
        name: `Temporary one-unit item ${runId.slice(0, 8)}`,
        category: "Essentials",
        price: 25_000,
        stockQuantity: 1,
        reservedQuantity: 0,
        lowStockThreshold: 0,
        pickupAvailable: true,
        availability: "IN_STOCK",
      },
    });
    productId = product.id;
    await approveFixtureProduct(productId, seller.id);

    const batchBlockedProduct = await prisma.product.create({
      data: {
        merchantId,
        branchId,
        name: `Temporary blocked-batch variant ${runId.slice(0, 8)}`,
        category: "Essentials",
        price: 30_000,
        stockQuantity: 5,
        reservedQuantity: 0,
        lowStockThreshold: 0,
        pickupAvailable: true,
        deliveryAvailable: true,
        availability: "IN_STOCK",
      },
    });
    variantProductId = batchBlockedProduct.id;
    await approveFixtureProduct(variantProductId, seller.id);
    const variant = await prisma.productVariant.create({
      data: { productId: variantProductId, name: "Test variant", stockQuantity: 5, reservedQuantity: 0 },
    });
    variantId = variant.id;
    await prisma.productBatch.create({
      data: { productId: variantProductId, merchantId, lotId: `RECALLED-${runId}`, quantity: 5, status: "RECALLED", recallNote: "Test-only blocked batch" },
    });

    const overflowProduct = await prisma.product.create({
      data: {
        merchantId, branchId, name: `Temporary exact-total overflow ${runId.slice(0, 8)}`,
        category: "Essentials", price: 1_000_000_000, stockQuantity: 10, reservedQuantity: 0,
        lowStockThreshold: 0, pickupAvailable: true, availability: "IN_STOCK",
      },
    });
    overflowProductId = overflowProduct.id;
    await approveFixtureProduct(overflowProductId, seller.id);
    const liveVariant = await prisma.productVariant.create({
      data: { productId: overflowProductId, name: "Temporary reservable option", priceDelta: 0, stockQuantity: 5, reservedQuantity: 0 },
    });
    liveVariantId = liveVariant.id;

    const privateProduct = await prisma.product.create({
      data: {
        merchantId, branchId, name: `Temporary unpublished variant ${runId.slice(0, 8)}`,
        category: "Essentials", price: 10_000, stockQuantity: 4, reservedQuantity: 0,
        lowStockThreshold: 0, pickupAvailable: true, availability: "IN_STOCK",
      },
    });
    privateVariantProductId = privateProduct.id;
    await prisma.productVariant.create({
      data: { productId: privateVariantProductId, name: "Private option", sku: `PRIVATE-${runId.slice(0, 8)}`, barcode: `HIDDEN-${runId.slice(0, 8)}`, stockQuantity: 4 },
    });

    cookieA = await login(emailA, password);
    cookieB = await login(emailB, password);
    sellerCookie = await login(sellerEmail, password);
  }, 30_000);

  afterAll(async () => {
    try {
      const fixtureProductIds = [productId, variantProductId, overflowProductId, privateVariantProductId].filter(Boolean);
      if (fixtureProductIds.length) {
        const reservations = await prisma.reservation.findMany({ where: { productId: { in: fixtureProductIds } }, select: { id: true } });
        const reservationIds = reservations.map((reservation) => reservation.id);
        if (reservationIds.length) {
          await prisma.notification.deleteMany({ where: { resourceType: "Reservation", resourceId: { in: reservationIds } } });
          await prisma.auditLog.deleteMany({ where: { resourceType: "Reservation", resourceId: { in: reservationIds } } });
          await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
        }
        await prisma.cartItem.deleteMany({ where: { productId: { in: fixtureProductIds } } });
        await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
      }
      if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
      if (merchantId) {
        await prisma.merchantMembership.deleteMany({ where: { merchantId } });
        await prisma.merchant.deleteMany({ where: { id: merchantId } });
      }
      if (userIds.length) {
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
        await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects an unconfigured delivery choice instead of silently converting it to pickup", async () => {
    const response = await fetch(`${BASE}/api/cart/items`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: 1, fulfilment: "DELIVERY" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not arrange delivery/i);
  });

  it("serves variant details only for public listings and reports batch-capped availability", async () => {
    const publicResponse = await fetch(`${BASE}/api/merchant/variants?productId=${encodeURIComponent(variantProductId)}`);
    expect(publicResponse.status).toBe(200);
    const publicData = await publicResponse.json();
    expect(publicData.variants).toHaveLength(1);
    expect(publicData.variants[0].availableQuantity).toBe(0);
    expect(publicData.variants[0].effectivePrice).toBe(30_000);
    expect(publicData.variants[0]).not.toHaveProperty("sku");
    expect(publicData.variants[0]).not.toHaveProperty("barcode");

    const privateResponse = await fetch(`${BASE}/api/merchant/variants?productId=${encodeURIComponent(privateVariantProductId)}`);
    expect(privateResponse.status).toBe(404);
  });

  it("rejects malformed variant price deltas without rounding or creating a row", async () => {
    const before = await prisma.productVariant.count({ where: { productId: variantProductId } });
    const response = await fetch(`${BASE}/api/merchant/variants`, {
      method: "POST",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: variantProductId, name: "Invalid fractional delta", priceDelta: 1.5, stockQuantity: 1 }),
    });
    expect(response.status).toBe(400);
    expect(await prisma.productVariant.count({ where: { productId: variantProductId } })).toBe(before);
  });

  it("rejects a whole-Naira list budget that cannot fit the persisted minor-unit field", async () => {
    const name = `Temporary invalid list budget ${runId.slice(0, 8)}`;
    const before = await prisma.shoppingList.count({ where: { ownerId: userIds[0], name } });
    const response = await fetch(`${BASE}/api/lists`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ name, spendingLimit: "21474837" }),
    });
    expect(response.status).toBe(400);
    expect(await prisma.shoppingList.count({ where: { ownerId: userIds[0], name } })).toBe(before);
  });

  it("rejects excess money precision in bulk import without creating a product", async () => {
    const name = `Temporary invalid money row ${runId.slice(0, 8)}`;
    const response = await fetch(`${BASE}/api/merchant/products/bulk`, {
      method: "POST",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId, branchId, mode: "create", rows: [{ name, price: "1.005", stockQuantity: "1" }] }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(await prisma.product.count({ where: { merchantId, branchId, name } })).toBe(0);
  });

  it("fails closed for unconfigured delivery flags, search, and saved-search alerts", async () => {
    const customize = await fetch(`${BASE}/api/merchant/customize`, {
      method: "PUT",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId, deliveryAvailable: true, deliveryFee: "100.50" }),
    });
    expect(customize.status).toBe(503);
    expect((await customize.json()).code).toBe("FEATURE_NOT_CONFIGURED");

    const createMerchant = await fetch(`${BASE}/api/merchant`, {
      method: "POST",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ businessName: "Temporary delivery gate", category: "SUPERMARKET", address: "Test address", phone: "08000000000", stateCode: "NG-AB", lgaCode: "NG-AB-01", deliveryAvailable: true }),
    });
    expect(createMerchant.status).toBe(503);

    const search = await fetch(`${BASE}/api/v1/search?q=rice&delivery=true`);
    expect(search.status).toBe(503);
    expect((await search.json()).code).toBe("FEATURE_NOT_CONFIGURED");

    const savedSearch = await fetch(`${BASE}/api/saved-searches`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "rice delivery", alertEnabled: true }),
    });
    expect(savedSearch.status).toBe(503);
    expect((await savedSearch.json()).code).toBe("FEATURE_NOT_CONFIGURED");
  });

  it("allows only one of two concurrent plans to reserve the last unit", async () => {
    const add = (cookie: string) => fetch(`${BASE}/api/cart/items`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    expect((await add(cookieA)).status).toBe(201);
    expect((await add(cookieB)).status).toBe(201);

    const submit = (cookie: string) => fetch(`${BASE}/api/cart/submit`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    const responses = await Promise.all([submit(cookieA), submit(cookieB)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map((response) => response.json()));
    const created = results.flatMap((result) => result.created);
    const failed = results.flatMap((result) => result.failed);

    expect(created).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(results.some((result) => result.message.includes("No payment or delivery"))).toBe(true);

    const product = await prisma.product.findUnique({ where: { id: productId }, select: { stockQuantity: true, reservedQuantity: true } });
    expect(product).toEqual({ stockQuantity: 1, reservedQuantity: 1 });
    const reservation = await prisma.reservation.findUnique({ where: { id: created[0].reservationId } });
    expect(reservation?.pickupWindow).toBeNull();
    expect(reservation?.status).toBe("PENDING");
  });

  it("prevents merchant stock edits from going below an active reservation", async () => {
    const response = await fetch(`${BASE}/api/merchant/products/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ stockQuantity: 0 }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/below the quantity already reserved/i);
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { stockQuantity: true, reservedQuantity: true } });
    expect(product).toEqual({ stockQuantity: 1, reservedQuantity: 1 });
  });

  it("releases and consumes both product and variant stock across reservation transitions", async () => {
    const createReservation = () => fetch(`${BASE}/api/reservations`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: overflowProductId, variantId: liveVariantId, quantity: 2 }),
    });
    const first = await createReservation();
    expect(first.status).toBe(200);
    const firstData = await first.json();
    const consumerList = await fetch(`${BASE}/api/reservations`, { headers: { Cookie: cookieA } });
    const listed = (await consumerList.json()).reservations.find((item: { id: string }) => item.id === firstData.reservation.id);
    expect(consumerList.status).toBe(200);
    expect(listed).toBeTruthy();
    expect(listed).not.toHaveProperty("consumerId");
    expect(listed.product).not.toHaveProperty("deliveryAvailable");
    expect(listed.merchant).not.toHaveProperty("deliveryAvailable");
    expect(listed.merchant).not.toHaveProperty("deliveryFee");
    const merchantDetail = await fetch(`${BASE}/api/reservations/${encodeURIComponent(firstData.reservation.id)}`, { headers: { Cookie: sellerCookie } });
    expect(merchantDetail.status).toBe(200);
    const merchantReservation = (await merchantDetail.json()).reservation;
    expect(merchantReservation).not.toHaveProperty("consumerId");
    expect(merchantReservation.merchant).not.toHaveProperty("deliveryAvailable");
    let stock = await prisma.product.findUnique({ where: { id: overflowProductId }, select: { stockQuantity: true, reservedQuantity: true } });
    let variantStock = await prisma.productVariant.findUnique({ where: { id: liveVariantId }, select: { stockQuantity: true, reservedQuantity: true } });
    expect(stock).toEqual({ stockQuantity: 10, reservedQuantity: 2 });
    expect(variantStock).toEqual({ stockQuantity: 5, reservedQuantity: 2 });

    const cancelled = await fetch(`${BASE}/api/reservations/${encodeURIComponent(firstData.reservation.id)}`, {
      method: "PATCH",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).reservation.status).toBe("CANCELLED");
    const duplicateCancel = await fetch(`${BASE}/api/reservations/${encodeURIComponent(firstData.reservation.id)}`, {
      method: "PATCH",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    expect(duplicateCancel.status).toBe(400);
    stock = await prisma.product.findUnique({ where: { id: overflowProductId }, select: { stockQuantity: true, reservedQuantity: true } });
    variantStock = await prisma.productVariant.findUnique({ where: { id: liveVariantId }, select: { stockQuantity: true, reservedQuantity: true } });
    expect(stock).toEqual({ stockQuantity: 10, reservedQuantity: 0 });
    expect(variantStock).toEqual({ stockQuantity: 5, reservedQuantity: 0 });

    const second = await createReservation();
    expect(second.status).toBe(200);
    const secondData = await second.json();
    const transition = async (action: string) => fetch(`${BASE}/api/reservations/${encodeURIComponent(secondData.reservation.id)}`, {
      method: "PATCH",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    expect((await transition("confirm")).status).toBe(200);
    expect((await transition("ready")).status).toBe(200);
    const collected = await transition("collect");
    expect(collected.status).toBe(200);
    expect((await collected.json()).reservation.status).toBe("COLLECTED");

    stock = await prisma.product.findUnique({ where: { id: overflowProductId }, select: { stockQuantity: true, reservedQuantity: true } });
    variantStock = await prisma.productVariant.findUnique({ where: { id: liveVariantId }, select: { stockQuantity: true, reservedQuantity: true } });
    expect(stock).toEqual({ stockQuantity: 8, reservedQuantity: 0 });
    expect(variantStock).toEqual({ stockQuantity: 3, reservedQuantity: 0 });
  });

  it("does not let variant stock bypass a recalled product batch", async () => {
    await prisma.cartItem.deleteMany({ where: { productId } });

    const direct = await fetch(`${BASE}/api/reservations`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: variantProductId, variantId, quantity: 1 }),
    });
    expect(direct.status).toBe(409);
    expect((await direct.json()).error).toMatch(/not enough available stock/i);

    const add = await fetch(`${BASE}/api/cart/items`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: variantProductId, variantId, quantity: 1 }),
    });
    expect(add.status).toBe(201);

    const plan = await fetch(`${BASE}/api/cart`, { headers: { Cookie: cookieA } });
    const plannedItem = (await plan.json()).groups.flatMap((group: { items: Array<{ availability: string }> }) => group.items)[0];
    expect(plannedItem.availability).toBe("UNAVAILABLE");

    const submitted = await fetch(`${BASE}/api/cart/submit`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(submitted.status).toBe(200);
    const result = await submitted.json();
    expect(result.created).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/not enough reservable stock/i);

    const product = await prisma.product.findUnique({ where: { id: variantProductId }, select: { reservedQuantity: true } });
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { reservedQuantity: true } });
    const reservationCount = await prisma.reservation.count({ where: { productId: variantProductId } });
    expect(product?.reservedQuantity).toBe(0);
    expect(variant?.reservedQuantity).toBe(0);
    expect(reservationCount).toBe(0);
  });

  it("does not publish unverified paid-plan prices or activate a paid plan", async () => {
    const plansResponse = await fetch(`${BASE}/api/merchant/subscription?merchantId=${encodeURIComponent(merchantId)}`, { headers: { Cookie: sellerCookie } });
    expect(plansResponse.status).toBe(200);
    const plans = await plansResponse.json();
    expect(Object.keys(plans.plans)).toEqual(["FREE"]);
    expect(plans.note).toMatch(/paid plan prices.*not configured/i);

    const activation = await fetch(`${BASE}/api/merchant/subscription`, {
      method: "POST",
      headers: { Cookie: sellerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId, plan: "PRO" }),
    });
    expect(activation.status).toBe(503);
    expect((await activation.json()).code).toBe("FEATURE_NOT_CONFIGURED");
  });

  it("rejects an oversized exact cart total without creating a reservation or stock hold", async () => {
    const carts = await prisma.cart.findMany({ where: { userId: userIds[0] }, select: { id: true } });
    await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map((cart) => cart.id) } } });
    const reservationsBefore = await prisma.reservation.count({ where: { productId: overflowProductId } });

    const add = await fetch(`${BASE}/api/cart/items`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: overflowProductId, quantity: 3 }),
    });
    expect(add.status).toBe(201);

    const submit = await fetch(`${BASE}/api/cart/submit`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(submit.status).toBe(200);
    const result = await submit.json();
    expect(result.created).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/transaction field limit/i);

    const product = await prisma.product.findUnique({ where: { id: overflowProductId }, select: { reservedQuantity: true } });
    expect(product?.reservedQuantity).toBe(0);
    expect(await prisma.reservation.count({ where: { productId: overflowProductId } })).toBe(reservationsBefore);
    expect(await prisma.cartItem.count({ where: { productId: overflowProductId } })).toBe(1);
  });
});
