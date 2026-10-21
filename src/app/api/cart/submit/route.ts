import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateCode } from "@/lib/utils";
import { InventoryConflictError, reserveInventoryUnits } from "@/lib/reservation-stock";
import { requirePolicyAcceptances, requirePolicyAcceptancesInTransaction } from "@/lib/legal";
import { publicMarketplaceProductInTransaction } from "@/lib/marketplace";
import { addProductPriceDeltaMinor, MoneyAmountError, multiplyMinorUnits } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

class CartItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartItemError";
  }
}

function userSafeReason(error: unknown) {
  if (error instanceof CartItemError || error instanceof InventoryConflictError || error instanceof MoneyAmountError) return error.message;
  return "Could not submit this item. Refresh your plan and try again.";
}

/**
 * A planning cart is not an order. Submit creates independent, pending pickup
 * reservations per item. Each item is revalidated and stock is temporarily
 * held until merchant action or expiry; no payment/delivery provider is used.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const policyCheck = await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] });
  if (!policyCheck.allowed) return NextResponse.json({ error: policyCheck.message || "Review Live policies before submitting reservations.", code: policyCheck.code, missingPolicies: policyCheck.missing, policyUrl: "/legal" }, { status: policyCheck.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });

  const cart = await prisma.cart.findFirst({ where: { userId: user.id, status: "PLANNING" } });
  if (!cart) return NextResponse.json({ error: "No active plan" }, { status: 400 });

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!items.length) return NextResponse.json({ error: "Your plan is empty" }, { status: 400 });

  const created: Array<{
    productId: string;
    reservationId: string;
    code: string;
    merchantId: string;
    status: "PENDING_MERCHANT_CONFIRMATION";
    expiresAt: Date;
    duplicate?: boolean;
  }> = [];
  const failed: Array<{ productId: string; name: string; reason: string }> = [];

  for (const item of items) {
    const idempotencyKey = `${user.id}:cart:${cart.id}:${item.id}`;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const prior = await tx.reservation.findUnique({ where: { idempotencyKey } });
        if (prior) {
          if (prior.consumerId !== user.id || prior.productId !== item.productId || prior.quantity !== item.quantity) {
            throw new CartItemError("This plan item changed after submission. Remove it and add it again.");
          }
          await tx.cartItem.deleteMany({ where: { id: item.id, cartId: cart.id } });
          return { reservation: prior, duplicate: true };
        }

        const product = await tx.product.findUnique({
          where: { id: item.productId },
          include: { merchant: true, branch: true },
        });
        if (!product || product.archived) throw new CartItemError("This item is no longer listed.");
        if (!await publicMarketplaceProductInTransaction(tx, product.id)) throw new CartItemError("This listing is not currently available for reservations.");
        if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) {
          throw new CartItemError(`This listing uses ${product.currency || "an unsupported currency"}; reservations are not configured for that currency in this market.`);
        }
        if (item.merchantId !== product.merchantId) throw new CartItemError("The item's merchant changed. Remove it and add it again.");
        if (item.fulfilment !== "PICKUP") throw new CartItemError("Live does not arrange delivery. Only pickup requests can be submitted.");
        if (product.merchant.status !== "APPROVED") throw new CartItemError("This merchant is not approved for reservations.");
        const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: product.merchant.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: product.merchantId });
        if (!sellerPolicy.allowed) throw new CartItemError("The merchant owner has not accepted the current seller agreement; no reservation was created.");
        if (product.merchant.storeStatus !== "OPEN") throw new CartItemError("This store is marked closed.");
        if (!product.pickupAvailable || !product.merchant.pickupAvailable) throw new CartItemError("Pickup is not available for this item or store.");
        if (!product.branchId || !product.branch || product.branch.merchantId !== product.merchantId) {
          throw new CartItemError("This listing has no valid stock branch and cannot be reserved until the merchant assigns one.");
        }
        if (product.branch.storeStatus !== "OPEN") throw new CartItemError("This store branch is marked closed.");
        if (item.branchId && item.branchId !== product.branchId) throw new CartItemError("The item's pickup branch changed. Remove it and add it again.");

        const batches = await tx.productBatch.findMany({ where: { productId: product.id } });
        const now = new Date();
        const blockedQuantity = batches
          .filter((batch) => batch.status !== "ACTIVE" || (batch.expiresAt && batch.expiresAt < now))
          .reduce((sum, batch) => sum + batch.quantity, 0);
        const productAvailable = Math.max(0, Math.max(0, product.stockQuantity - blockedQuantity) - product.reservedQuantity);
        let available = productAvailable;
        let variant = null;
        let unitPrice = addProductPriceDeltaMinor(product.price, 0);

        if (item.variantId) {
          variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
          if (!variant || variant.productId !== product.id) throw new CartItemError("This product option is no longer available.");
          const variantAvailable = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
          // Batch records currently attach to the parent product; without a
          // batch-to-variant mapping, never allow variant stock to bypass a block.
          available = Math.min(productAvailable, variantAvailable);
          unitPrice = addProductPriceDeltaMinor(product.price, variant.priceDelta);
        }
        if (available < item.quantity) throw new CartItemError("Not enough reservable stock. Refresh your plan before retrying.");

        if (!variant) {
          const promotion = await tx.promotion.findFirst({
            where: { productId: product.id, validFrom: { lte: now }, validUntil: { gt: now } },
            orderBy: { validFrom: "desc" },
          });
          if (promotion) unitPrice = addProductPriceDeltaMinor(promotion.promoPrice, 0);
        }

        const totalAmount = multiplyMinorUnits(unitPrice, item.quantity);
        const correlationId = randomUUID();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const reservation = await tx.reservation.create({
          data: {
            code: generateCode(),
            consumerId: user.id,
            merchantId: product.merchantId,
            productId: product.id,
            quantity: item.quantity,
            priceSnapshot: unitPrice,
            totalAmount,
            status: "PENDING",
            pickupWindow: null,
            branchId: product.branchId,
            variantId: variant?.id || null,
            idempotencyKey,
            correlationId,
            expiresAt,
          },
        });

        await reserveInventoryUnits(tx, product, variant, item.quantity);
        await tx.notification.createMany({
          data: [
            { recipientId: product.merchant.ownerId, type: "RESERVATION_RECEIVED", title: "New reservation request", body: `A customer requested ${item.quantity}× ${product.name}`, resourceType: "Reservation", resourceId: reservation.id },
            { recipientId: user.id, type: "RESERVATION_RECEIVED", title: "Reservation request sent", body: `Your reservation ${reservation.code} is pending merchant confirmation.`, resourceType: "Reservation", resourceId: reservation.id },
          ],
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "CART_RESERVATION_CREATE",
            resourceType: "Reservation",
            resourceId: reservation.id,
            correlationId,
            outcome: "PENDING",
            metadata: JSON.stringify({ cartId: cart.id, productId: product.id, quantity: item.quantity }),
          },
        });
        await tx.cartItem.deleteMany({ where: { id: item.id, cartId: cart.id } });
        return { reservation, duplicate: false };
      });

      created.push({
        productId: item.productId,
        reservationId: result.reservation.id,
        code: result.reservation.code,
        merchantId: result.reservation.merchantId,
        status: "PENDING_MERCHANT_CONFIRMATION",
        expiresAt: result.reservation.expiresAt,
        ...(result.duplicate ? { duplicate: true } : {}),
      });
    } catch (error) {
      failed.push({
        productId: item.productId,
        name: item.product.name,
        reason: userSafeReason(error),
      });
    }
  }

  const remainingItems = await prisma.cartItem.count({ where: { cartId: cart.id } });
  if (remainingItems === 0) {
    await prisma.cart.updateMany({ where: { id: cart.id, status: "PLANNING" }, data: { status: "SUBMITTED" } });
  }

  const message = created.length
    ? `${created.length} separate reservation request(s) submitted. Stock is temporarily held pending merchant confirmation or expiry. No payment or delivery is arranged by Live.`
    : "No reservations were created. Review the item messages and try again.";

  return NextResponse.json({ created, failed, message }, { headers: { "Cache-Control": "private, no-store" } });
}
