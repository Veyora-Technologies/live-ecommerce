import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canEditInventory, merchantRole } from "@/lib/permissions";
import { syncProductMarketplaceListing } from "@/lib/marketplace";
import { bulkCurrencyError, formatBulkExportPrice, parseBulkImportPrice } from "@/lib/bulk-csv-money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const payloadSchema = z.object({
  merchantId: z.string().min(1).max(40),
  branchId: z.string().min(1).max(64),
  mode: z.enum(["create", "upsert"]),
  rows: z.array(z.unknown()).min(1).max(500),
}).strict();
const rowSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(80).optional().nullable(),
  price: z.union([z.string().max(30), z.number().finite()]),
  currency: z.string().trim().max(3).optional(),
  stockQuantity: z.union([z.string().max(20), z.number().finite()]),
  lowStockThreshold: z.union([z.string().max(20), z.number().finite()]).optional(),
  unit: z.string().trim().max(20).optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(80).optional().nullable(),
});

function integer(value: string | number | undefined, min: number, max: number): number | null {
  if (value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "Provide a merchant, import mode, and 1–500 product rows." }, { status: 400 });
  const { merchantId, branchId, mode, rows } = payload.data;
  const role = await merchantRole(merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden — your role cannot edit inventory" }, { status: 403 });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, merchantId }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Choose a branch that belongs to this merchant before importing stock" }, { status: 400 });

  const results: Array<{ row: number; status: string; id?: string; error?: string }> = [];
  let success = 0, failed = 0;
  for (let index = 0; index < rows.length; index++) {
    const parsed = rowSchema.safeParse(rows[index]);
    if (!parsed.success) {
      results.push({ row: index + 1, status: "failed", error: "Invalid row fields; check required columns and lengths." });
      failed++; continue;
    }
    const row = parsed.data;
    const currencyError = bulkCurrencyError(row.currency);
    if (currencyError) {
      results.push({ row: index + 1, status: "failed", error: currencyError });
      failed++; continue;
    }
    const price = parseBulkImportPrice(row.price, row.currency);
    const stock = integer(row.stockQuantity, 0, 1_000_000);
    const lowStockThreshold = integer(row.lowStockThreshold, 0, 100_000) ?? 5;
    if (price === null || stock === null || (row.lowStockThreshold !== undefined && integer(row.lowStockThreshold, 0, 100_000) === null)) {
      results.push({ row: index + 1, status: "failed", error: "Price must be a nonnegative NGN major-unit amount with supported precision; stock and threshold must be whole nonnegative numbers." });
      failed++; continue;
    }
    const sku = row.sku?.trim() || null;
    const barcode = row.barcode?.trim() || null;
    const availability = stock <= 0 ? "OUT_OF_STOCK" : stock <= lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";

    try {
      const existing = await prisma.product.findFirst({ where: { merchantId, branchId, name: row.name, sku, archived: false } });
      if (existing && !getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, existing.currency || DEFAULT_MARKET_CODE)) {
        results.push({ row: index + 1, status: "failed", error: "Bulk price edits are unavailable for this product currency; Live has not converted it." });
        failed++; continue;
      }
      if (mode === "create" && existing) {
        results.push({ row: index + 1, status: "failed", error: "A product with this name and SKU already exists." });
        failed++; continue;
      }
      if (existing && stock < existing.reservedQuantity) {
        results.push({ row: index + 1, status: "failed", error: "Stock cannot be reduced below the quantity already reserved; reconcile pending reservations first." });
        failed++; continue;
      }
      const product = await prisma.$transaction(async (tx) => {
        if (existing) {
          const data = {
            category: row.category || existing.category,
            brand: row.brand ?? existing.brand,
            price, stockQuantity: stock, lowStockThreshold,
            unit: row.unit || existing.unit,
            barcode: barcode || existing.barcode,
            availability, lastConfirmedAt: new Date(),
          };
          const claimed = await tx.product.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt, reservedQuantity: existing.reservedQuantity }, data });
          if (claimed.count !== 1) throw new Error("CONFLICT");
          const updated = await tx.product.findUnique({ where: { id: existing.id } });
          if (!updated) throw new Error("CONFLICT");
          await tx.availabilityEvent.create({ data: {
            merchantId, productId: updated.id, previousQuantity: existing.stockQuantity, newQuantity: stock,
            previousStatus: existing.availability, newStatus: availability, changeSource: "BULK_IMPORT", actorId: user.id,
          } });
          await tx.inventoryMovement.create({ data: {
            merchantId, productId: updated.id, previousQuantity: existing.stockQuantity, newQuantity: stock,
            delta: stock - existing.stockQuantity, reason: "BULK_UPSERT", actorId: user.id,
          } });
          if (price !== existing.price) await tx.priceObservation.create({ data: { merchantId, productId: updated.id, price, source: "BULK_IMPORT" } });
          if (barcode && barcode !== existing.barcode) await tx.productIdentifier.create({ data: { productId: updated.id, type: "BARCODE", value: barcode } });
          const listingContentChanged = price !== existing.price
            || (row.category !== undefined && row.category !== existing.category)
            || (row.brand !== undefined && row.brand !== existing.brand)
            || (row.unit !== undefined && row.unit !== existing.unit);
          await syncProductMarketplaceListing(tx, updated.id, user.id, { contentChanged: listingContentChanged });
          return updated;
        }
        const created = await tx.product.create({ data: {
          merchantId, branchId, name: row.name, category: row.category || "Essentials", brand: row.brand || null,
          price, stockQuantity: stock, lowStockThreshold, unit: row.unit || "pcs", sku,
          barcode, availability, lastConfirmedAt: new Date(),
        } });
        await tx.availabilityEvent.create({ data: {
          merchantId, productId: created.id, previousQuantity: 0, newQuantity: stock,
          previousStatus: null, newStatus: availability, changeSource: "BULK_IMPORT", actorId: user.id,
        } });
        await tx.inventoryMovement.create({ data: {
          merchantId, productId: created.id, previousQuantity: 0, newQuantity: stock,
          delta: stock, reason: "BULK_CREATE", actorId: user.id,
        } });
        await tx.priceObservation.create({ data: { merchantId, productId: created.id, price, source: "BULK_IMPORT" } });
        if (barcode) await tx.productIdentifier.create({ data: { productId: created.id, type: "BARCODE", value: barcode } });
        await syncProductMarketplaceListing(tx, created.id, user.id);
        return created;
      });
      results.push({ row: index + 1, status: existing ? "updated" : "created", id: product.id });
      success++;
    } catch (error) {
      results.push({ row: index + 1, status: "failed", error: error instanceof Error && error.message === "CONFLICT" ? "This product changed during import. Export the latest catalogue and retry this row." : "Row was not committed; check the CSV values and try again." });
      failed++;
    }
  }

  await prisma.auditLog.create({ data: { actorId: user.id, action: "BULK_IMPORT", resourceType: "Merchant", resourceId: merchantId, metadata: JSON.stringify({ branchId, success, failed, mode, total: rows.length }) } });
  return NextResponse.json({ success, failed, total: rows.length, results });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const merchantId = req.nextUrl.searchParams.get("merchantId");
  const branchId = req.nextUrl.searchParams.get("branchId");
  if (!merchantId || merchantId.length > 40 || !branchId || branchId.length > 64) return NextResponse.json({ error: "merchantId and branchId are required" }, { status: 400 });
  if (!await merchantRole(merchantId, user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!await prisma.branch.findFirst({ where: { id: branchId, merchantId }, select: { id: true } })) return NextResponse.json({ error: "Branch not found for this merchant" }, { status: 404 });
  const products = await prisma.product.findMany({ where: { merchantId, branchId, archived: false }, orderBy: { name: "asc" } });
  if (products.some((product) => !getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)
    || formatBulkExportPrice(product.price, product.currency) === null)) {
    return NextResponse.json({ error: "This catalogue contains a price or currency the NGN bulk-import format cannot preserve. No CSV was generated; Live has not converted any price.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const header = ["name", "category", "brand", "price", "currency", "stockQuantity", "lowStockThreshold", "unit", "sku", "barcode", "availability"].join(",");
  const rows = products.map((product) => [product.name, product.category, product.brand, formatBulkExportPrice(product.price, product.currency)!, product.currency, product.stockQuantity, product.lowStockThreshold, product.unit, product.sku, product.barcode, product.availability].map(csv).join(","));
  return new NextResponse([header, ...rows].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="products-${merchantId}.csv"`, "Cache-Control": "private, no-store" },
  });
}
