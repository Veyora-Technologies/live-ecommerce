import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateCode } from "@/lib/utils";
import { InventoryConflictError, reserveInventoryUnits } from "@/lib/reservation-stock";
import { requirePolicyAcceptances, requirePolicyAcceptancesInTransaction, getLegalReleaseGate } from "@/lib/legal";
import { publicMarketplaceProductInTransaction } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const acceptSchema = z.object({ responseId: z.string().trim().min(1).max(64) }).strict();

class QuoteActionError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "QuoteActionError";
  }
}

function acceptanceSummary(quote: { price: number | null; additionalFees: number | null; request: { quantity: number }; fulfilment: string | null }) {
  const quantity = quote.request.quantity;
  const price = quote.price ?? 0;
  const fees = quote.additionalFees ?? 0;
  return { price, quantity, additionalFees: fees, total: price * quantity + fees, fulfilment: quote.fulfilment || "PICKUP" };
}

/**
 * Accepts a seller-reported quote. A linked product is rechecked and stock is
 * atomically reserved; a quote without a product remains a quote only and does
 * not create a stocked reservation. Furnivo does not collect payment or arrange delivery.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const marketplaceGate = await getLegalReleaseGate("MARKETPLACE");
  if (!marketplaceGate.ready) return NextResponse.json({ error: marketplaceGate.publicMessage, code: "LEGAL_RELEASE_GATE", policyUrl: "/legal" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const consumerPolicy = await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] });
  if (!consumerPolicy.allowed) return NextResponse.json({ error: consumerPolicy.message || "Review Furnivo policies before accepting a quote.", code: consumerPolicy.code, missingPolicies: consumerPolicy.missing, policyUrl: "/legal" }, { status: consumerPolicy.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });

  const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valid responseId required" }, { status: 400 });
  const quote = await prisma.itemRequestResponse.findUnique({
    where: { id: parsed.data.responseId },
    include: { request: true, merchant: { select: { id: true, ownerId: true, status: true, businessName: true } } },
  });
  if (!quote || !quote.merchant) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.request.requesterId !== user.id) return NextResponse.json({ error: "Quote not found or access is not permitted." }, { status: 404 });

  const idempotencyKey = `${user.id}:quote:${quote.id}`;
  if (quote.status === "ACCEPTED") {
    const reservation = await prisma.reservation.findUnique({ where: { idempotencyKey } });
    return NextResponse.json({ reservation, accepted: acceptanceSummary(quote), duplicate: true, note: reservation ? "This quote was already accepted. The linked reservation remains pending merchant confirmation." : "This quote was already accepted; no stocked reservation was created because it had no linked product." }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (quote.status !== "OPEN") return NextResponse.json({ error: `Quote is ${quote.status.toLowerCase()} and cannot be accepted.` }, { status: 409 });
  if (quote.request.status === "CANCELLED" || quote.request.status === "EXPIRED" || quote.request.status === "MATCHED" || quote.request.status === "FULFILLED") return NextResponse.json({ error: "This item request is no longer open for quote acceptance." }, { status: 409 });
  if (quote.price === null || quote.price < 0) return NextResponse.json({ error: "This response has no valid price and cannot be accepted." }, { status: 400 });
  const quotedUnitPrice = quote.price;
  const now = new Date();
  if (quote.validUntil && quote.validUntil <= now) {
    await prisma.itemRequestResponse.updateMany({ where: { id: quote.id, status: "OPEN" }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Quote has expired. Ask the merchant for a refreshed quote." }, { status: 409 });
  }
  if (quote.fulfilment && quote.fulfilment !== "PICKUP") return NextResponse.json({ error: "Delivery is not enabled for quote acceptance. This request was not accepted; choose pickup or contact the seller about their own arrangements." }, { status: 409 });
  if (quote.quantityAvailable !== null && quote.quantityAvailable < quote.request.quantity) return NextResponse.json({ error: "The seller-reported quantity is below the quantity requested. Ask for a revised quote." }, { status: 409 });

  const quantity = quote.request.quantity;
  const fees = quote.additionalFees ?? 0;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isInteger(fees) || fees < 0) return NextResponse.json({ error: "The stored quote contains unsupported quantity or fee values." }, { status: 409 });
  const totalAmount = quotedUnitPrice * quantity + fees;
  if (!Number.isSafeInteger(totalAmount) || totalAmount > 2_147_483_647) return NextResponse.json({ error: "The quoted total exceeds the supported record range." }, { status: 400 });
  if (quote.merchant.status !== "APPROVED") return NextResponse.json({ error: "This merchant is not currently able to accept a quote." }, { status: 409 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: quote.merchant!.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: quote.merchantId });
      if (!sellerPolicy.allowed) throw new QuoteActionError("The merchant owner has not accepted the current seller agreement. The quote was not accepted.", 428, "LEGAL_POLICY_REQUIRED");

      const claimed = await tx.itemRequestResponse.updateMany({ where: { id: quote.id, status: "OPEN" }, data: { status: "ACCEPTED" } });
      if (!claimed.count) throw new QuoteActionError("This quote has already changed. Refresh before trying again.", 409, "QUOTE_NOT_OPEN");
      const requestClaim = await tx.itemRequest.updateMany({ where: { id: quote.requestId, status: { in: ["OPEN", "RESPONDED"] } }, data: { status: "MATCHED" } });
      if (!requestClaim.count) throw new QuoteActionError("This item request is no longer open for quote acceptance.", 409, "REQUEST_NOT_OPEN");

      let reservation = null;
      if (quote.productId) {
        const product = await tx.product.findUnique({ where: { id: quote.productId }, include: { merchant: true, branch: true } });
        if (!product || product.archived || product.merchantId !== quote.merchantId) throw new QuoteActionError("The quoted product is no longer available from this merchant.", 404, "PRODUCT_UNAVAILABLE");
        if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) throw new QuoteActionError("Reservations are not configured for this listing's currency in the active market. Furnivo has not converted the amount.", 409, "CURRENCY_NOT_SUPPORTED");
        if (!await publicMarketplaceProductInTransaction(tx, product.id)) throw new QuoteActionError("The quoted listing is no longer eligible for reservations.", 404, "MARKETPLACE_LISTING_NOT_PUBLIC");
        if (product.merchant.status !== "APPROVED" || product.merchant.storeStatus !== "OPEN") throw new QuoteActionError("This merchant is not currently accepting reservations.", 409, "MERCHANT_UNAVAILABLE");
        if (!product.pickupAvailable || !product.merchant.pickupAvailable) throw new QuoteActionError("Pickup is not available for this product or merchant.", 409, "PICKUP_UNAVAILABLE");
        if (!product.branchId || !product.branch || product.branch.merchantId !== product.merchantId || product.branch.storeStatus !== "OPEN") throw new QuoteActionError("The listing has no currently valid pickup branch.", 409, "BRANCH_UNAVAILABLE");
        if (quote.branchId && quote.branchId !== product.branchId) throw new QuoteActionError("The quoted branch no longer matches the product listing.", 409, "BRANCH_MISMATCH");

        const batches = await tx.productBatch.findMany({ where: { productId: product.id }, select: { quantity: true, status: true, expiresAt: true } });
        const blockedQuantity = batches.filter((batch) => batch.status !== "ACTIVE" || Boolean(batch.expiresAt && batch.expiresAt < now)).reduce((sum, batch) => sum + batch.quantity, 0);
        const available = Math.max(0, product.stockQuantity - blockedQuantity - product.reservedQuantity);
        if (available < quantity) throw new QuoteActionError("Current reservable stock is below the requested quantity. The quote was not accepted.", 409, "INSUFFICIENT_STOCK");

        const expiresAt = new Date(Math.min(now.getTime() + 24 * 60 * 60 * 1000, quote.validUntil?.getTime() ?? Number.POSITIVE_INFINITY));
        const correlationId = randomUUID();
        reservation = await tx.reservation.create({
          data: {
            code: generateCode(),
            consumerId: user.id,
            merchantId: product.merchantId,
            productId: product.id,
            quantity,
            priceSnapshot: quotedUnitPrice,
            totalAmount,
            status: "PENDING",
            pickupWindow: null,
            branchId: product.branchId,
            idempotencyKey,
            correlationId,
            expiresAt,
          },
        });
        await reserveInventoryUnits(tx, product, null, quantity);
        await tx.notification.createMany({ data: [
          { recipientId: product.merchant.ownerId, type: "QUOTE_ACCEPTED", title: "Quote accepted", body: `${user.name} accepted a seller-reported quote for ${quantity}× ${product.name}. Pending merchant confirmation.`, resourceType: "Reservation", resourceId: reservation.id },
          { recipientId: user.id, type: "RESERVATION_RECEIVED", title: "Quote accepted; reservation pending", body: `Your accepted quote is linked to reservation ${reservation.code}. No payment was collected.`, resourceType: "Reservation", resourceId: reservation.id },
        ] });
        await tx.auditLog.create({ data: { actorId: user.id, action: "QUOTE_ACCEPTED_RESERVATION_CREATED", resourceType: "Reservation", resourceId: reservation.id, correlationId, outcome: "PENDING", metadata: JSON.stringify({ quoteResponseId: quote.id, itemRequestId: quote.requestId, quantity, quotedUnitPrice, sellerQuotedAdditionalFees: fees }) } });
      } else {
        await tx.notification.create({ data: { recipientId: quote.merchant!.ownerId, type: "QUOTE_ACCEPTED", title: "Quote accepted", body: `A customer accepted your seller-reported quote for “${quote.request.productName}”. No stocked product reservation was created.`, resourceType: "ItemRequest", resourceId: quote.requestId } });
        await tx.auditLog.create({ data: { actorId: user.id, action: "QUOTE_ACCEPTED_WITHOUT_PRODUCT", resourceType: "ItemRequestResponse", resourceId: quote.id, outcome: "ACCEPTED", metadata: JSON.stringify({ itemRequestId: quote.requestId, sellerQuotedPrice: quote.price, sellerQuotedAdditionalFees: fees }) } });
      }
      return { reservation };
    });

    return NextResponse.json({
      reservation: result.reservation,
accepted: { price: quotedUnitPrice, quantity, additionalFees: fees, total: totalAmount, fulfilment: "PICKUP", validUntil: quote.validUntil },
      note: result.reservation
        ? "Seller-reported quote accepted and linked to a pending reservation. Stock was rechecked and temporarily reserved; merchant confirmation is still required. Furnivo collected no payment and arranged no delivery."
        : "Seller-reported quote accepted. No product was linked, so no reservation, stock hold, payment, or fulfillment was created.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof InventoryConflictError) return NextResponse.json({ error: cause.message }, { status: 409 });
    if (cause instanceof QuoteActionError) return NextResponse.json({ error: cause.message, ...(cause.code ? { code: cause.code } : {}) }, { status: cause.status });
    if (String((cause as { code?: unknown })?.code) === "P2002") {
      const prior = await prisma.reservation.findUnique({ where: { idempotencyKey } });
      if (prior) return NextResponse.json({ reservation: prior, accepted: { price: quotedUnitPrice, quantity, additionalFees: fees, total: totalAmount, fulfilment: "PICKUP", validUntil: quote.validUntil }, duplicate: true, note: "This quote already created a reservation; it remains pending merchant confirmation." }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Quote acceptance could not be completed. No partial reservation was saved." }, { status: 500 });
  }
}
