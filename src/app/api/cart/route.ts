import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { availabilityConfidence } from "@/lib/confidence";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { addProductPriceDeltaMinor } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

/** Multi-merchant planner cart. This is not an order; prices/stock are re-read from Furnivo's current records. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  let cart = await prisma.cart.findFirst({ where: { userId: user.id, status: "PLANNING" } });
  if (!cart) cart = await prisma.cart.create({ data: { userId: user.id } });
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { product: { include: { merchant: true, branch: true } } },
    orderBy: { id: "asc" },
  });

  const uniqueProducts = [...new Map(items.map((item) => [item.product.id, item.product])).values()];
  const currentProducts = await withReservableAvailability(uniqueProducts);
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));
  const variantIds = items.flatMap((item) => item.variantId ? [item.variantId] : []);
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } } })
    : [];
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const byMerchant = new Map<string, {
    merchant: { id: string; name: string; area: string; storeStatus: string };
    items: Array<Record<string, unknown>>;
    subtotal: bigint;
  }>();
  let total = 0n;

  for (const item of items) {
    const product = item.product;
    const merchant = product.merchant;
    const current = currentById.get(product.id);
    const selectedVariant = item.variantId ? variantById.get(item.variantId) : null;
    const variantUnavailable = Boolean(item.variantId && (!selectedVariant || selectedVariant.productId !== product.id));
    const currencyCode = product.currency || DEFAULT_MARKET_CODE;
    const currencySupported = Boolean(getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, currencyCode));
    let unitPrice: number | null = null;
    if (currencySupported && !variantUnavailable) {
      try { unitPrice = addProductPriceDeltaMinor(product.price, selectedVariant?.priceDelta ?? 0); }
      catch { unitPrice = null; }
    }
    const priceUnavailable = unitPrice === null;
    const quantityIsValid = Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99;
    const productAvailable = current?.reservableQuantity || 0;
    const variantAvailable = selectedVariant
      ? Math.max(0, selectedVariant.stockQuantity - selectedVariant.reservedQuantity)
      : productAvailable;
    // Batch records are product-scoped, not variant-scoped; conservatively cap
    // variant stock by the product's unblocked reservable quantity.
    const availableQty = variantUnavailable || priceUnavailable ? 0 : Math.min(productAvailable, variantAvailable);
    const pickupReady = merchant.status === "APPROVED"
      && merchant.storeStatus === "OPEN"
      && merchant.pickupAvailable
      && product.pickupAvailable
      && Boolean(product.branchId && product.branch && product.branch.merchantId === merchant.id && product.branch.storeStatus === "OPEN");

    let availability = "NOT_RESERVABLE";
    if (!currencySupported) availability = "CURRENCY_UNSUPPORTED";
    else if (!quantityIsValid) availability = "INVALID_QUANTITY";
    else if (variantUnavailable) availability = "OPTION_UNAVAILABLE";
    else if (!pickupReady) availability = "NOT_RESERVABLE";
    else if (availableQty <= 0) availability = "UNAVAILABLE";
    else if (availableQty < item.quantity) availability = "INSUFFICIENT";
    else {
      availability = availabilityConfidence({
        availability: selectedVariant ? "IN_STOCK" : current?.effectiveAvailability || product.availability,
        category: product.category,
        stockQuantity: availableQty,
        lastConfirmedAt: product.lastConfirmedAt,
        updatedAt: product.updatedAt,
        merchant,
      }).label;
    }

    if (!byMerchant.has(merchant.id)) {
      byMerchant.set(merchant.id, {
        merchant: { id: merchant.id, name: merchant.businessName, area: merchant.area, storeStatus: merchant.storeStatus },
        items: [],
        subtotal: 0n,
      });
    }
    const lineTotalMinor = unitPrice === null || !quantityIsValid ? null : BigInt(unitPrice) * BigInt(item.quantity);
    const lineTotal = lineTotalMinor === null ? null : lineTotalMinor.toString();
    const savedPriceIsValid = currencySupported && Number.isSafeInteger(item.priceAtAdd) && item.priceAtAdd >= 0;
    const priceAtAdd = savedPriceIsValid ? item.priceAtAdd : null;
    byMerchant.get(merchant.id)!.items.push({
      cartItemId: item.id,
      productId: product.id,
      name: product.name,
      variantId: item.variantId,
      variantName: selectedVariant?.name || null,
      quantity: item.quantity,
      fulfilment: item.fulfilment,
      currencyCode,
      unitPrice,
      priceAtAdd,
      priceChanged: unitPrice !== null && (!savedPriceIsValid || unitPrice !== item.priceAtAdd),
      lineTotal,
      availability,
    });
    if (lineTotalMinor !== null) {
      byMerchant.get(merchant.id)!.subtotal += lineTotalMinor;
      total += lineTotalMinor;
    }
  }

  return NextResponse.json({
    cartId: cart.id,
    groups: [...byMerchant.values()].map((group) => ({ ...group, subtotal: group.subtotal.toString() })),
    totalItemsValue: total.toString(),
    deliveryNote: "Furnivo does not arrange delivery. Plan submissions are pickup-only; no delivery or service fee is quoted or charged.",
    warning: "A cart is a plan, not a reservation. Submission revalidates stock and creates separate pending holds; each merchant must confirm. Holds are released by the scheduled expiry job, which must be configured by the operator.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
