import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { merchantRole, canEditInventory } from "@/lib/permissions";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { addProductPriceDeltaMinor, MoneyAmountError } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const parseIntegerInput = (value: unknown) => {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : Number.NaN;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
};
const minorUnitDelta = z.preprocess(parseIntegerInput, z.number().int().min(-1_000_000_000).max(1_000_000_000));
const stockQuantity = z.preprocess(parseIntegerInput, z.number().int().min(0).max(1_000_000));
const createSchema = z.object({
  productId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().max(80).optional(),
  attributes: z.record(z.string(), z.unknown()).optional().nullable(),
  // Signed integer minor units (kobo for NGN), never naira or a rounded decimal.
  priceDelta: minorUnitDelta.optional().default(0),
  stockQuantity: stockQuantity.optional().default(0),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(80).optional().nullable(),
}).strict();
const patchSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120).optional(),
  priceDelta: minorUnitDelta.optional(),
  stockQuantity: stockQuantity.optional(),
}).strict().refine((value) => value.name !== undefined || value.priceDelta !== undefined || value.stockQuantity !== undefined, "No variant changes supplied");

function invalidResponse(message = "Invalid variant details") {
  return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** Public, approved-listing variants only. Private SKUs and raw lot/stock fields are never returned. */
export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("productId") || "";
  if (!productId || productId.length > 40) return NextResponse.json({ variants: [] }, { headers: { "Cache-Control": "no-store" } });
  const product = await prisma.product.findFirst({
    where: { id: productId, archived: false, merchant: { status: "APPROVED" } },
    select: { id: true, price: true, stockQuantity: true, reservedQuantity: true, lowStockThreshold: true, availability: true },
  });
  if (!product || !await isPublicMarketplaceProduct(product.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const [parentAvailability] = await withReservableAvailability([product]);
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, name: true, attributes: true, priceDelta: true, stockQuantity: true, reservedQuantity: true },
    orderBy: { createdAt: "asc" },
  });

  const publicVariants = variants.flatMap((variant) => {
    let attributes: unknown = null;
    try { attributes = variant.attributes ? JSON.parse(variant.attributes) : null; } catch {}
    const attributeObject = attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? attributes as Record<string, unknown>
      : {};
    const unitCandidate = attributeObject.unit ?? attributeObject.size;
    const unit = typeof unitCandidate === "string" && unitCandidate.length <= 80 ? unitCandidate : null;
    let effectivePrice: number;
    try { effectivePrice = addProductPriceDeltaMinor(product.price, variant.priceDelta); }
    catch { return []; }
    const variantAvailable = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
    const availableQuantity = Math.min(parentAvailability.reservableQuantity, variantAvailable);
    return [{ id: variant.id, name: variant.name, unit, priceDelta: variant.priceDelta, effectivePrice, availableQuantity }];
  });

  return NextResponse.json({ variants: publicVariants }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidResponse("Provide a name, valid integer stock count, and price delta in minor units.");
  const body = parsed.data;
  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const role = await merchantRole(product.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Variant pricing is unavailable for this product currency in the active market.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  try { addProductPriceDeltaMinor(product.price, body.priceDelta); }
  catch (cause) {
    return invalidResponse(cause instanceof MoneyAmountError ? cause.message : "Variant price is invalid.");
  }
  const attributes = body.attributes ?? (body.unit ? { unit: body.unit } : null);
  let serializedAttributes: string | null = null;
  if (attributes) {
    serializedAttributes = JSON.stringify(attributes);
    if (serializedAttributes.length > 2000) return invalidResponse("Variant attributes exceed the supported size.");
  }
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: body.name,
      attributes: serializedAttributes,
      priceDelta: body.priceDelta,
      stockQuantity: body.stockQuantity,
      sku: body.sku || null,
      barcode: body.barcode || null,
    },
  });
  return NextResponse.json({ variant }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidResponse("Provide a variant id and at least one valid change.");
  const body = parsed.data;
  const variant = await prisma.productVariant.findUnique({ where: { id: body.id }, include: { product: true } });
  if (!variant) return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  const role = await merchantRole(variant.product.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, variant.product.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Variant pricing is unavailable for this product currency in the active market.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const nextPriceDelta = body.priceDelta ?? variant.priceDelta;
  const nextStockQuantity = body.stockQuantity ?? variant.stockQuantity;
  if (nextStockQuantity < variant.reservedQuantity) {
    return NextResponse.json({ error: "Stock cannot be reduced below the quantity already reserved; reconcile pending reservations first." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  try { addProductPriceDeltaMinor(variant.product.price, nextPriceDelta); }
  catch (cause) {
    return invalidResponse(cause instanceof MoneyAmountError ? cause.message : "Variant price is invalid.");
  }

  const data = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.priceDelta !== undefined ? { priceDelta: body.priceDelta } : {}),
    ...(body.stockQuantity !== undefined ? { stockQuantity: body.stockQuantity } : {}),
  };
  const claimed = await prisma.productVariant.updateMany({
    where: { id: variant.id, updatedAt: variant.updatedAt, reservedQuantity: variant.reservedQuantity },
    data,
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "Variant inventory changed while saving. Refresh and review the current record." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const updated = await prisma.productVariant.findUnique({ where: { id: variant.id } });
  if (!updated) return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  return NextResponse.json({ variant: updated }, { headers: { "Cache-Control": "private, no-store" } });
}
