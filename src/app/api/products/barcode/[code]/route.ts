import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { publicMarketplaceProductIds } from "@/lib/marketplace";

export async function GET(_: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (code.length < 2 || code.length > 120) return NextResponse.json({ error: "Barcode or identifier length is invalid." }, { status: 400 });
  const matches = await prisma.product.findMany({
    where: {
      archived: false, merchant: { status: "APPROVED" },
      OR: [{ barcode: code }, { sku: code }, { identifiers: { some: { value: code } } }],
    },
    include: { merchant: { select: { businessName: true, area: true, storeStatus: true, status: true } } },
    take: 10,
  });
  const publicIds = await publicMarketplaceProductIds(matches.map((product) => product.id));
  const publicMatches = matches.filter((product) => publicIds.has(product.id));
  if (!publicMatches.length) return NextResponse.json({ found: false, message: "No approved public listing carries that identifier." }, { headers: { "Cache-Control": "private, no-store" } });
  const products = await withReservableAvailability(publicMatches);
  return NextResponse.json({
    found: true,
    note: "An identifier match helps find a listing; it does not prove local stock, product safety, or that two listings are the same variant. Availability is merchant-reported and reservations recheck stock.",
    products: products.map((product) => ({
      id: product.id, name: product.name, price: product.price,
      availability: product.effectiveAvailability, reservableQuantity: product.reservableQuantity,
      lastConfirmedAt: product.lastConfirmedAt,
      merchant: product.merchant.businessName, area: product.merchant.area,
      storeStatus: product.merchant.storeStatus,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
