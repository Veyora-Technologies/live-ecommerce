import { prisma } from "@/lib/db";
import { haversine } from "@/lib/utils";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { getLegalReleaseGate } from "@/lib/legal";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration } from "@/lib/market-config";

export async function compareProducts(input: {
  productName?: string;
  ids?: string[];
  category?: string;
  area?: string;
  lat?: number;
  lng?: number;
}) {
  const legalGate = await getLegalReleaseGate("MARKETPLACE");
  if (!legalGate.ready) return { error: legalGate.publicMessage, code: "LEGAL_RELEASE_GATE" as const, products: [], priceHistory: [], note: "Marketplace comparisons are unavailable until the release gate is ready." };
  const productName = (input.productName || "").trim().slice(0, 120);
  const category = (input.category || "").trim().slice(0, 60);
  const area = (input.area || "").trim().slice(0, 60);
  const hasCoordinates = Number.isFinite(input.lat) && Number.isFinite(input.lng) && input.lat! >= -90 && input.lat! <= 90 && input.lng! >= -180 && input.lng! <= 180;
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const publicFilter = { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } };

  let products;
  const ids = [...new Set((input.ids || []).map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,40}$/.test(id)))].slice(0, 10);
  if (ids.length) {
    products = await prisma.product.findMany({ where: { ...publicFilter, id: { in: ids } }, include: { merchant: true } });
  } else if (productName) {
    const candidates = await prisma.product.findMany({ where: publicFilter, include: { merchant: true }, take: 500, orderBy: { updatedAt: "desc" } });
    const normalized = productName.toLocaleLowerCase();
    const terms = normalized.split(/\s+/).filter((term) => term.length > 2);
    products = candidates.filter((product) => {
      const name = product.name.toLocaleLowerCase();
      return name.includes(normalized) || (terms.length > 0 && terms.every((term) => name.includes(term)));
    });
  } else {
    return { error: "Provide productName or public product IDs." as const, products: [], priceHistory: [], note: "" };
  }

  const publicIds = await publicMarketplaceProductIds(products.map((product) => product.id));
  products = products.filter((product) => publicIds.has(product.id));
  if (category) products = products.filter((product) => product.category.toLocaleLowerCase() === category.toLocaleLowerCase());
  if (area) products = products.filter((product) => product.merchant.area.toLocaleLowerCase() === area.toLocaleLowerCase());
  products = await withReservableAvailability(products);
  const enriched = products.map((product) => {
    let distance: number | null = null;
    if (hasCoordinates && product.merchant.lat !== null && product.merchant.lng !== null) {
      distance = haversine(input.lat!, input.lng!, product.merchant.lat, product.merchant.lng);
    }
    return {
      id: product.id, name: product.name, brand: product.brand, category: product.category,
      specs: product.description, quantity: product.unit, price: product.price,
      availability: product.effectiveAvailability,
      reservableQuantity: product.reservableQuantity,
      lastConfirmedAt: product.lastConfirmedAt,
      freshnessHours: product.lastConfirmedAt ? Math.max(0, Math.round((Date.now() - product.lastConfirmedAt.getTime()) / 3600000)) : null,
      distance: distance === null ? null : Number(distance.toFixed(1)),
      distanceType: distance === null ? null : "STRAIGHT_LINE",
      pickupAvailable: product.pickupAvailable && product.merchant.pickupAvailable,
      merchant: {
        id: product.merchant.id, businessName: product.merchant.businessName, area: product.merchant.area,
        storeStatus: product.merchant.storeStatus, verificationStatus: product.merchant.verificationStatus,
      },
    };
  }).sort((a, b) => a.price - b.price);

  let priceHistory: Array<{ price: number; observedAt: Date; source: string }> = [];
  const first = enriched[0];
  if (first) {
    priceHistory = await prisma.priceObservation.findMany({
      where: { productId: first.id }, orderBy: { observedAt: "asc" }, take: 20,
      select: { price: true, observedAt: true, source: true },
    });
  }
  return {
    query: productName,
    count: enriched.length,
    products: enriched,
    priceHistory: priceHistory.map((item) => ({ price: item.price, observedAt: item.observedAt, source: item.source })),
    note: "Results match or resemble the supplied product name; they are not guaranteed to be the same brand, size, or specification. Listed prices are merchant-reported. Live delivery integrations are not configured; delivery is not verified or arranged here. Availability excludes blocked, expired, or already-reserved stock. Any distance is straight-line, not road distance.",
  };
}
