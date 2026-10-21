import { prisma } from "@/lib/db";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { getGeographicScopeFilter, type LocationScope } from "@/lib/geography";
import { DEFAULT_MARKET_CODE, getMarketMerchantWhere, getMarketProductWhere } from "@/lib/market-config";

export async function getLivePulseUpdates(locationCodes: string[] = [], scope: LocationScope = "nationwide", legacyArea?: string | null, countryCode = DEFAULT_MARKET_CODE) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const locationFilter = await getGeographicScopeFilter(locationCodes, scope, countryCode);
  const marketMerchantWhere = getMarketMerchantWhere(locationFilter.countryCode);
  const marketProductWhere = getMarketProductWhere(locationFilter.countryCode);
  const merchantWhere: any = { status: "APPROVED", AND: [marketMerchantWhere, locationFilter.where] };
  if (legacyArea) merchantWhere.area = legacyArea;
  const events = await prisma.availabilityEvent.findMany({
    where: {
      createdAt: { gte: since },
      changeSource: { in: ["MERCHANT_CREATE", "MERCHANT_UPDATE", "BULK_IMPORT"] },
      merchant: merchantWhere,
      product: { archived: false, availability: { in: ["IN_STOCK", "LOW_STOCK"] }, AND: [marketProductWhere] },
    },
    include: {
      product: { include: { merchant: true } },
      merchant: { select: { id: true, businessName: true, area: true } },
    },
    orderBy: { createdAt: "desc" }, take: 60,
  });
  const seen = new Set<string>();
  const freshest = events.filter((event) => {
    if (seen.has(event.productId)) return false;
    seen.add(event.productId);
    const confirmed = event.product.lastConfirmedAt?.getTime();
    return Boolean(confirmed && Math.abs(event.createdAt.getTime() - confirmed) <= 60_000 && event.product.availability === event.newStatus);
  });
  const publicIds = await publicMarketplaceProductIds(freshest.map((event) => event.productId), locationFilter.countryCode);
  const publicFreshest = freshest.filter((event) => publicIds.has(event.productId));
  const inventory = await withReservableAvailability(publicFreshest.map((event) => event.product));
  const currentById = new Map(inventory.map((product) => [product.id, product]));
  return publicFreshest
    .filter((event) => (currentById.get(event.productId)?.reservableQuantity || 0) > 0)
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      productId: event.productId,
      name: event.product.name,
      category: event.product.category,
      price: event.product.price,
      availability: event.product.availability,
      reservableQuantity: currentById.get(event.productId)?.reservableQuantity || 0,
      imageUrl: event.product.imageUrl,
      merchant: event.merchant.businessName,
      area: event.merchant.area,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      changeSource: event.changeSource,
      confirmedAt: event.product.lastConfirmedAt?.toISOString() || event.createdAt.toISOString(),
    }));
}
