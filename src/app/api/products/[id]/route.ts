import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { merchantLocationLabel } from "@/lib/location-label";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await isPublicMarketplaceProduct(id)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const product = await prisma.product.findFirst({
    where: { id, archived: false, merchant: { status: "APPROVED" } },
    include: {
      merchant: {
        select: {
          id: true, businessName: true, category: true, address: true, area: true, city: true,
          countryCode: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true,
          state: { select: { code: true, name: true, type: true } },
          lga: { select: { code: true, name: true, type: true } },
          cityArea: { select: { code: true, name: true, type: true } },
          locality: { select: { code: true, name: true, type: true } },
          phone: true, email: true, whatsapp: true, imageUrl: true,
          storeStatus: true, openingHours: true, verificationStatus: true,
          pickupAvailable: true,
        },
      },
    },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [withAvailability] = await withReservableAvailability([product]);
  const productPayload: Record<string, unknown> = { ...withAvailability };
  delete productPayload.deliveryAvailable;
  const merchantPayload: Record<string, unknown> = { ...withAvailability.merchant };
  delete merchantPayload.deliveryAvailable;
  delete merchantPayload.deliveryFee;
  return NextResponse.json({ product: { ...productPayload, merchant: { ...merchantPayload, locationLabel: merchantLocationLabel(withAvailability.merchant) } } }, { headers: { "Cache-Control": "private, no-store" } });
}
