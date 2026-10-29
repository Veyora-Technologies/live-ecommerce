import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPublicMarketplaceProduct, publicMarketplaceProductInTransaction } from "@/lib/marketplace";
import { addProductPriceDeltaMinor, MoneyAmountError } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const privateHeaders = { "Cache-Control": "private, no-store" };

class UnsupportedCurrencyError extends Error {}

async function activeCart(userId: string) {
  let cart = await prisma.cart.findFirst({ where: { userId, status: "PLANNING" } });
  if (!cart) cart = await prisma.cart.create({ data: { userId } });
  return cart;
}

const addItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  fulfilment: z.enum(["PICKUP"]).optional().default("PICKUP"),
}).strict();

const removeItemSchema = z.object({ itemId: z.string().min(1) }).strict();

/** A planner entry is not a reservation; price/stock are rechecked on submit. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    const deliveryRequested = typeof body === "object" && body !== null && "fulfilment" in body && body.fulfilment === "DELIVERY";
    return NextResponse.json({
      error: deliveryRequested ? "Furnivo does not arrange delivery. Add this item for pickup only." : "Invalid plan item details",
    }, { status: 400 });
  }

  const { productId, variantId, quantity, fulfilment } = parsed.data;
  const productExists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, archived: true, currency: true } });
  if (!productExists || productExists.archived || !await isPublicMarketplaceProduct(productId)) return NextResponse.json({ error: "Product not found" }, { status: 404, headers: privateHeaders });
  if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, productExists.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: `This listing uses ${productExists.currency || "an unsupported currency"}; reservations are not configured for that currency in this market.`, code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: privateHeaders });
  }
  const cart = await activeCart(user.id);
  try {
    const item = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, merchantId: true, branchId: true, price: true, currency: true, archived: true } });
      if (!product || product.archived || !await publicMarketplaceProductInTransaction(tx, productId)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
      if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) throw new UnsupportedCurrencyError("This listing currency is not supported for reservation requests in this market.");
      let priceDelta = 0;
      if (variantId) {
        const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
        if (!variant || variant.productId !== product.id) throw new Error("VARIANT_NOT_FOUND");
        priceDelta = variant.priceDelta;
      }
      const unitPrice = addProductPriceDeltaMinor(product.price, priceDelta);
      const existing = await tx.cartItem.findFirst({ where: { cartId: cart.id, productId: product.id, variantId: variantId || null } });
      const nextQuantity = existing && Number.isSafeInteger(existing.quantity) && existing.quantity >= 1
        ? Math.min(99, existing.quantity + quantity)
        : quantity;
      return existing
        ? tx.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQuantity, priceAtAdd: unitPrice, fulfilment } })
        : tx.cartItem.create({ data: {
          cartId: cart.id,
          productId: product.id,
          merchantId: product.merchantId,
          branchId: product.branchId,
          variantId: variantId || null,
          quantity,
          priceAtAdd: unitPrice,
          fulfilment,
        } });
    });
    return NextResponse.json({ item, note: "Added to your plan. This does not reserve stock; details are rechecked when you submit." }, { status: 201, headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof UnsupportedCurrencyError) return NextResponse.json({ error: cause.message, code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: privateHeaders });
    if (cause instanceof Error && cause.message === "VARIANT_NOT_FOUND") return NextResponse.json({ error: "Variant not found" }, { status: 404, headers: privateHeaders });
    if (cause instanceof Error && cause.message === "MARKETPLACE_LISTING_NOT_PUBLIC") return NextResponse.json({ error: "Product is not currently available" }, { status: 404, headers: privateHeaders });
    if (cause instanceof MoneyAmountError) return NextResponse.json({ error: cause.message, code: "AMOUNT_OUT_OF_RANGE" }, { status: 422, headers: privateHeaders });
    return NextResponse.json({ error: "Plan item could not be saved" }, { status: 500, headers: privateHeaders });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = removeItemSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan item" }, { status: 400 });
  const item = await prisma.cartItem.findUnique({ where: { id: parsed.data.itemId }, include: { cart: true } });
  if (!item || item.cart.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.cartItem.delete({ where: { id: item.id } });
  return NextResponse.json({ ok: true });
}
