import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canEditInventory } from "@/lib/permissions";
import { productCreateSchema, parseOr400 } from "@/lib/validate";
import { syncProductMarketplaceListing } from "@/lib/marketplace";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const merchantId = new URL(req.url).searchParams.get("merchantId");
  let ids: string[];
  if (merchantId) {
    if (!await merchantRole(merchantId, user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    ids = [merchantId];
  } else {
    const merchants = await prisma.merchant.findMany({
      where: { OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, status: "ACTIVE" } } }] },
      select: { id: true },
    });
    ids = merchants.map((merchant) => merchant.id);
  }
  const products = ids.length ? await prisma.product.findMany({
    where: { merchantId: { in: ids }, archived: false },
    include: { merchant: true, branch: { include: { state: true, lga: true, cityArea: true } } }, orderBy: { updatedAt: "desc" },
  }) : [];
  return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = parseOr400(productCreateSchema, await req.json().catch(() => null));
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  const role = await merchantRole(body.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden — your role cannot add inventory" }, { status: 403 });
  const branchId = body.branchId || null;
  if (!branchId) return NextResponse.json({ error: "Create and select a branch before adding stock. Each branch keeps a separate inventory." }, { status: 400 });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, merchantId: body.merchantId }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Choose a branch that belongs to this merchant" }, { status: 400 });

  const lowStockThreshold = body.lowStockThreshold ?? 5;
  const availability = body.stockQuantity <= 0 ? "OUT_OF_STOCK" : body.stockQuantity <= lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";
  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          merchantId: body.merchantId, branchId, name: body.name, category: body.category,
          brand: body.brand ?? null, description: body.description ?? null,
          price: body.price, stockQuantity: body.stockQuantity, lowStockThreshold,
          unit: body.unit ?? "pcs", imageUrl: body.imageUrl ?? null,
          sku: body.sku ?? null, barcode: body.barcode ?? null, availability,
          lastConfirmedAt: new Date(),
        },
        include: { branch: { include: { state: true, lga: true, cityArea: true } } },
      });
      await tx.availabilityEvent.create({
        data: { merchantId: body.merchantId, productId: created.id, newStatus: availability, newQuantity: created.stockQuantity, changeSource: "MERCHANT_CREATE", actorId: user.id },
      });
      await tx.inventoryMovement.create({
        data: { merchantId: body.merchantId, productId: created.id, previousQuantity: 0, newQuantity: created.stockQuantity, delta: created.stockQuantity, reason: "CREATE", actorId: user.id },
      });
      await tx.priceObservation.create({ data: { merchantId: body.merchantId, productId: created.id, price: created.price, source: "CREATE" } });
      if (body.barcode) await tx.productIdentifier.create({ data: { productId: created.id, type: "BARCODE", value: body.barcode } });
      await syncProductMarketplaceListing(tx, created.id, user.id);
      return created;
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Product could not be added. Check merchant setup and retry; no marketplace publication was confirmed." }, { status: 400 });
  }
}
