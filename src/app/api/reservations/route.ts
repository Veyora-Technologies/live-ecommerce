import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateCode } from "@/lib/utils";
import { reservationSchema, parseOr400 } from "@/lib/validate";
import { sha256 } from "@/lib/security";
import { InventoryConflictError, reserveInventoryUnits } from "@/lib/reservation-stock";
import { requirePolicyAcceptances, requirePolicyAcceptancesInTransaction } from "@/lib/legal";
import { isPublicMarketplaceProduct, publicMarketplaceProductInTransaction } from "@/lib/marketplace";
import { addProductPriceDeltaMinor, MoneyAmountError, multiplyMinorUnits } from "@/lib/money";
import { reservationViewSelect } from "@/lib/reservation-view";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reservations = await prisma.reservation.findMany({
    where: { consumerId: user.id },
    select: reservationViewSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ reservations }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const policyCheck = await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] });
  if (!policyCheck.allowed) return NextResponse.json({ error: policyCheck.message || "Review Furnivo policies before reserving.", code: policyCheck.code, missingPolicies: policyCheck.missing, policyUrl: "/legal" }, { status: policyCheck.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });
  const correlationId = req.headers.get("x-request-id") || crypto.randomUUID();
  const parsed = parseOr400(reservationSchema, await req.json().catch(() => ({})));
  if ("response" in parsed) return parsed.response;
  const { productId, quantity: qty, variantId, branchId } = parsed.data;
  const rawHeaderIdempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (rawHeaderIdempotencyKey && !/^[A-Za-z0-9._:-]{8,120}$/.test(rawHeaderIdempotencyKey)) {
    return NextResponse.json({ error: "Idempotency-Key must be 8–120 letters, digits, dots, underscores, colons, or hyphens." }, { status: 400 });
  }
  if (!await isPublicMarketplaceProduct(productId)) return NextResponse.json({ error: "This listing is not currently available for reservations." }, { status: 404 });
  // Idempotency-Key header preferred; body key accepted. Falls back to legacy 2-min dedupe.
  const idemKey = rawHeaderIdempotencyKey || parsed.data.idempotencyKey || null;

  if (idemKey) {
    const existing = await prisma.reservation.findUnique({ where:{ idempotencyKey: `${user.id}:${idemKey}` } });
    if (existing) {
      if (existing.productId !== productId || existing.quantity !== qty || existing.variantId !== (variantId || null) || (branchId && existing.branchId !== branchId)) {
        return NextResponse.json({ error: "Idempotency key was used with different parameters" }, { status: 422 });
      }
      return NextResponse.json({ reservation: existing, duplicate: true });
    }
  } else {
    const recent = await prisma.reservation.findFirst({
      where: { consumerId: user.id, productId, quantity: qty, variantId: variantId || null, status: "PENDING", createdAt: { gte: new Date(Date.now() - 120000) } },
    });
    if (recent) return NextResponse.json({ reservation: recent, duplicate: true });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where:{ id: productId }, include:{ merchant: true, branch: true } });
      if (!product || product.archived) throw new Error("Product not found");
      if (!await publicMarketplaceProductInTransaction(tx, product.id)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
      if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) throw new Error("CURRENCY_NOT_SUPPORTED");
      const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: product.merchant.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: product.merchantId });
      if (!sellerPolicy.allowed) throw new Error("LEGAL_POLICY_REQUIRED");
      if (product.merchant.status !== "APPROVED") throw new Error("Merchant not approved");
      if (!product.branchId || !product.branch || product.branch.merchantId !== product.merchantId) throw new Error("This listing has no valid stock branch and cannot be reserved until the merchant assigns it.");
      if (product.merchant.storeStatus !== "OPEN" || product.branch.storeStatus !== "OPEN") throw new Error("This store branch is marked closed");
      if (branchId && product.branchId !== branchId) throw new Error("Branch mismatch for this listing");

      // Batch safety: blocked batches reduce sellable stock; all-blocked = not reservable.
      const batches = await tx.productBatch.findMany({ where:{ productId: product.id } });
      let batchBlockedQty = 0;
      for (const b of batches) {
        const blocked = b.status !== "ACTIVE" || (b.expiresAt && b.expiresAt < new Date());
        if (blocked) batchBlockedQty += b.quantity;
      }
      const sellable = Math.max(0, product.stockQuantity - batchBlockedQty);
      const productAvailable = Math.max(0, sellable - product.reservedQuantity);

      // Variant stock is also capped by the parent product because batches are
      // product-scoped until the schema models a batch-to-variant relationship.
      let variant: any = null;
      let available = productAvailable;
      let unitPrice = addProductPriceDeltaMinor(product.price, 0);
      if (variantId) {
        variant = await tx.productVariant.findUnique({ where:{ id: variantId } });
        if (!variant || variant.productId !== product.id) throw new Error("Variant not found");
        available = Math.min(productAvailable, Math.max(0, variant.stockQuantity - variant.reservedQuantity));
        unitPrice = addProductPriceDeltaMinor(product.price, variant.priceDelta);
      }
      if (available < qty) throw new Error("Not enough available stock (reserved by others or restricted)");

      // Active promotion (explicit validity; never an invented "was" price)
      const promo = await tx.promotion.findFirst({
        where:{ productId: product.id, validFrom:{ lte: new Date() }, validUntil:{ gt: new Date() } },
        orderBy:{ validFrom: "desc" },
      });
      if (promo && !variant) unitPrice = addProductPriceDeltaMinor(promo.promoPrice, 0);

      const totalAmount = multiplyMinorUnits(unitPrice, qty);
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const reservation = await tx.reservation.create({
        data:{
          code, consumerId: user.id, merchantId: product.merchantId, productId: product.id,
          quantity: qty, priceSnapshot: unitPrice, totalAmount,
          status: "PENDING", pickupWindow: null,
          branchId: branchId || product.branchId || null, variantId: variantId || null,
          idempotencyKey: idemKey ? `${user.id}:${idemKey}` : null, correlationId, expiresAt,
        },
      });

      await reserveInventoryUnits(tx, product, variant, qty);

      await tx.notification.create({
        data:{ recipientId: product.merchant.ownerId, type: "RESERVATION_RECEIVED", title: "New reservation", body: `A customer reserved ${qty}× ${product.name}`, resourceType: "Reservation", resourceId: reservation.id },
      });
      await tx.notification.create({
        data:{ recipientId: user.id, type: "RESERVATION_RECEIVED", title: "Reservation received", body: `Your reservation ${code} is pending confirmation`, resourceType: "Reservation", resourceId: reservation.id },
      });
      await tx.auditLog.create({
        data:{ actorId: user.id, action: "RESERVATION_CREATE", resourceType: "Reservation", resourceId: reservation.id, correlationId, outcome: "PENDING", metadata: JSON.stringify({ productId, qty, requestHash: sha256(`${productId}:${qty}:${variantId || ""}`) }) },
      });
      return reservation;
    });
    return NextResponse.json({ reservation: result });
  } catch (e: any) {
    if (e instanceof Error && e.message === "MARKETPLACE_LISTING_NOT_PUBLIC") return NextResponse.json({ error: "This listing is not currently available for reservations." }, { status: 404 });
    if (e instanceof Error && e.message === "LEGAL_POLICY_REQUIRED") return NextResponse.json({ error: "The seller has not accepted the current seller agreement. This reservation was not created." }, { status: 428 });
    if (e instanceof Error && e.message === "CURRENCY_NOT_SUPPORTED") return NextResponse.json({ error: "Reservations are not configured for this listing's currency in the active market. Furnivo has not converted the amount.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409 });
    // Unique idempotency race → return the winner's reservation
    if (idemKey && String(e?.code) === "P2002") {
      const winner = await prisma.reservation.findUnique({ where: { idempotencyKey: `${user.id}:${idemKey}` } });
      if (winner) {
        if (winner.productId !== productId || winner.quantity !== qty || winner.variantId !== (variantId || null) || (branchId && winner.branchId !== branchId)) {
          return NextResponse.json({ error: "Idempotency key was used with different parameters" }, { status: 422 });
        }
        return NextResponse.json({ reservation: winner, duplicate: true });
      }
    }
    if (e instanceof MoneyAmountError) return NextResponse.json({ error: e.message, code: "AMOUNT_OUT_OF_RANGE" }, { status: 422 });
    if (e instanceof InventoryConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    const safeDomainErrors = new Map<string, number>([
      ["Product not found", 404],
      ["Merchant not approved", 409],
      ["This listing has no valid stock branch and cannot be reserved until the merchant assigns it.", 409],
      ["This store branch is marked closed", 409],
      ["Branch mismatch for this listing", 400],
      ["Variant not found", 404],
      ["Not enough available stock (reserved by others or restricted)", 409],
    ]);
    if (e instanceof Error && safeDomainErrors.has(e.message)) {
      return NextResponse.json({ error: e.message }, { status: safeDomainErrors.get(e.message)! });
    }
    return NextResponse.json({ error: "Reservation could not be completed; no inventory change was committed." }, { status: 500 });
  }
}
