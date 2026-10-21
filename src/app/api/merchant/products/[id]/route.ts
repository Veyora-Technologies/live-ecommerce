import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canEditInventory } from "@/lib/permissions";
import { productPatchSchema, parseOr400 } from "@/lib/validate";
import { syncProductMarketplaceListing } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

function conflictResponse(product: any) {
  return NextResponse.json({
    error: "Inventory changed on the server while this draft was offline. Review the current record before applying your change.",
    product: {
      id: product.id, name: product.name, price: product.price, currency: product.currency,
      stockQuantity: product.stockQuantity, lowStockThreshold: product.lowStockThreshold,
      availability: product.availability, updatedAt: product.updatedAt,
    },
  }, { status: 409 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const role = await merchantRole(product.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden — your role cannot edit inventory (owner, manager or inventory staff only)" }, { status: 403 });

  const parsed = parseOr400(productPatchSchema, await req.json().catch(() => ({})));
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  if (body.price !== undefined && !getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Price edits are unavailable for this product currency in the active market. Live has not converted the amount.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (body.stockQuantity !== undefined && body.stockQuantity < product.reservedQuantity) {
    return NextResponse.json({ error: "Stock cannot be reduced below the quantity already reserved; reconcile pending reservations first." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const expected = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : product.updatedAt;
  if (expected.getTime() !== product.updatedAt.getTime()) return conflictResponse(product);

  const listingContentChanged = (body.name !== undefined && body.name !== product.name)
    || (body.price !== undefined && body.price !== product.price)
    || (body.category !== undefined && body.category !== product.category)
    || (body.brand !== undefined && body.brand !== product.brand)
    || (body.description !== undefined && body.description !== product.description)
    || (body.imageUrl !== undefined && body.imageUrl !== product.imageUrl)
    || (body.unit !== undefined && body.unit !== product.unit);
  const stockWasSubmitted = body.stockQuantity !== undefined;
  const thresholdWasSubmitted = body.lowStockThreshold !== undefined;
  const previousQuantity = product.stockQuantity;
  const previousStatus = product.availability;
  const nextQuantity = body.stockQuantity ?? product.stockQuantity;
  const nextThreshold = body.lowStockThreshold ?? product.lowStockThreshold;
  const availability = nextQuantity <= 0 ? "OUT_OF_STOCK" : nextQuantity <= nextThreshold ? "LOW_STOCK" : "IN_STOCK";
  const data: any = {};
  for (const key of ["name", "price", "stockQuantity", "lowStockThreshold", "category", "brand", "description", "imageUrl", "unit"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (stockWasSubmitted || thresholdWasSubmitted) data.availability = availability;
  // Only an explicit quantity recheck refreshes the availability timestamp.
  if (stockWasSubmitted) data.lastConfirmedAt = new Date();
  if (!Object.keys(data).length) return NextResponse.json({ error: "No product changes supplied" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Compare-and-swap in the database closes the race between the initial read and write.
      const claimed = await tx.product.updateMany({ where: { id, updatedAt: expected, reservedQuantity: product.reservedQuantity }, data });
      if (claimed.count !== 1) return null;
      const updated = await tx.product.findUnique({ where: { id } });
      if (!updated) return null;
      if (stockWasSubmitted) {
        await tx.availabilityEvent.create({
          data: {
            merchantId: product.merchantId, productId: id,
            previousQuantity, newQuantity: updated.stockQuantity,
            previousStatus, newStatus: availability,
            changeSource: "MERCHANT_UPDATE", actorId: user.id,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            merchantId: product.merchantId, productId: id,
            previousQuantity, newQuantity: updated.stockQuantity,
            delta: updated.stockQuantity - previousQuantity,
            reason: body.reason || "MANUAL_UPDATE", actorId: user.id,
          },
        });
      }
      if (body.price !== undefined && body.price !== product.price) {
        await tx.priceObservation.create({ data: { merchantId: product.merchantId, productId: id, price: body.price, source: "MERCHANT_UPDATE" } });
      }
      await syncProductMarketplaceListing(tx, id, user.id, { contentChanged: listingContentChanged });
      return updated;
    });
    if (!result) {
      const current = await prisma.product.findUnique({ where: { id } });
      return current ? conflictResponse(current) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ product: result });
  } catch {
    return NextResponse.json({ error: "Product update could not be saved. The existing product remains unchanged." }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const role = await merchantRole(product.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { archived: true } });
    await syncProductMarketplaceListing(tx, id, user.id);
  });
  return NextResponse.json({ ok: true });
}
