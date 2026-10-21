import { prisma } from "@/lib/db";
import { parseNaturalQuery } from "@/lib/nlp";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { parseMajorAmountToMinor } from "@/lib/money";
import { DEFAULT_MARKET_CODE, isMarketIntegrationReady } from "@/lib/market-config";

type SearchLike = { query: string; filters: string | null };
type ProductLike = {
  name: string; brand?: string | null; category?: string | null; price: number; availability: string;
  merchant: { area?: string | null; storeStatus?: string | null; verificationStatus?: string | null; pickupAvailable?: boolean; deliveryAvailable?: boolean };
};

function unpackFilters(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

type PriceBounds = { min: bigint | null; max: bigint | null };

function priceBounds(filters: Record<string, unknown>, parsed: ReturnType<typeof parseNaturalQuery>): PriceBounds | null {
  if (parsed.priceFilterInvalid) return null;
  const minRaw = filters.minPrice !== undefined ? filters.minPrice : parsed.minPrice;
  const maxRaw = filters.maxPrice !== undefined ? filters.maxPrice : parsed.maxPrice;
  const parseBound = (value: unknown): bigint | null | undefined => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    return parseMajorAmountToMinor(String(value), 2) ?? undefined;
  };
  const min = parseBound(minRaw);
  const max = parseBound(maxRaw);
  if (min === undefined || max === undefined) return null;
  return { min, max };
}

function withinPrice(price: number, bounds: PriceBounds): boolean {
  const minor = BigInt(price);
  return (bounds.min === null || minor >= bounds.min) && (bounds.max === null || minor <= bounds.max);
}

export function matchesSavedSearch(search: SearchLike, product: ProductLike): boolean {
  const parsed = parseNaturalQuery(search.query);
  const filters = unpackFilters(search.filters);
  // Never broaden a location-dependent request when Live has no enabled location/routing source.
  if (parsed.distanceKm || Number(filters.distanceKm) > 0 || typeof filters.fulfilment === "string") return false;
  const query = parsed.q.trim().toLocaleLowerCase("en");
  const productText = `${product.name} ${product.brand || ""} ${product.category || ""}`.toLocaleLowerCase("en");
  const terms = query.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && !["the", "and", "for", "with", "from", "near"].includes(term));
  if (terms.length && !terms.every((term) => productText.includes(term))) return false;

  const category = String(filters.category || parsed.category || "").trim();
  if (category && product.category?.toLocaleLowerCase("en") !== category.toLocaleLowerCase("en")) return false;
  const area = String(filters.area || parsed.area || "").trim();
  if (area && product.merchant.area?.toLocaleLowerCase("en") !== area.toLocaleLowerCase("en")) return false;
  const bounds = priceBounds(filters, parsed);
  if (!bounds || !withinPrice(product.price, bounds)) return false;
  if ((filters.openNow === true || parsed.openNow) && product.merchant.storeStatus !== "OPEN") return false;
  if ((filters.pickup === true || parsed.pickup) && !product.merchant.pickupAvailable) return false;
  const deliveryRequested = filters.delivery === true || filters.delivery === "true" || parsed.delivery;
  if (deliveryRequested && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations")) return false;
  if (deliveryRequested && !product.merchant.deliveryAvailable) return false;
  if ((filters.verified === true || parsed.verified) && product.merchant.verificationStatus !== "VERIFIED") return false;
  return true;
}

const FREQ_MS: Record<string, number> = { INSTANT: 5 * 60_000, DAILY: 24 * 60 * 60_000, WEEKLY: 7 * 24 * 60 * 60_000 };

/** Process only new real merchant inventory events; checkpoints and writes are transactional. */
export async function processSavedSearchAlerts(now = new Date()) {
  const searches = await prisma.savedSearch.findMany({
    where: { alertEnabled: true },
    include: { user: { include: { notificationPrefs: true } } },
    orderBy: { createdAt: "asc" }, take: 500,
  });
  let notificationsCreated = 0;
  let eventsChecked = 0;

  for (const search of searches) {
    const preference = search.user.notificationPrefs;
    if (preference?.pushEnabled === false || preference?.alertsForAvailable === false) continue;
    const frequency = FREQ_MS[search.alertFrequency] || FREQ_MS.DAILY;
    if (search.lastNotifiedAt && now.getTime() - search.lastNotifiedAt.getTime() < frequency) continue;

    const checkpoint = search.lastEvaluatedAt || search.createdAt;
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const events = await prisma.availabilityEvent.findMany({
      where: {
        createdAt: { gt: checkpoint, gte: since },
        changeSource: { in: ["MERCHANT_CREATE", "MERCHANT_UPDATE", "BULK_IMPORT"] },
        merchant: { status: "APPROVED" },
        product: { archived: false },
      },
      include: { product: { include: { merchant: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1000,
    });
    if (!events.length) continue;
    eventsChecked += events.length;
    const distinctProducts = [...new Map(events.map((event) => [event.productId, event.product])).values()];
    const inventory = await withReservableAvailability(distinctProducts);
    const inventoryById = new Map(inventory.map((product) => [product.id, product]));
    const matches = new Map<string, typeof inventory[number]>();

    for (const event of events) {
      const product = inventoryById.get(event.productId);
      if (product && matchesSavedSearch(search, product)) matches.set(product.id, product);
    }
    const products = [...matches.values()];
    const rawFilters = unpackFilters(search.filters);
    const parsed = parseNaturalQuery(search.query);
    const bounds = priceBounds(rawFilters, parsed);
    const matchesPrice = (price: number) => bounds !== null && withinPrice(price, bounds);
    const processedAt = events[events.length - 1].createdAt;

    const committed = await prisma.$transaction(async (tx) => {
      // Compare-and-set checkpoint so overlapping scheduler calls do not emit duplicate alerts.
      const claim = await tx.savedSearch.updateMany({
        where: { id: search.id, userId: search.userId, alertEnabled: true, lastEvaluatedAt: search.lastEvaluatedAt },
        data: { lastEvaluatedAt: processedAt },
      });
      if (claim.count !== 1) return false;
      const previousRows = await tx.savedSearchMatch.findMany({
        where: { savedSearchId: search.id, productId: { in: products.map((product) => product.id) } },
      });
      const previousByProduct = new Map(previousRows.map((row) => [row.productId, row]));
      const notify: Array<{ name: string; merchant: string }> = [];
      const writes: Array<Promise<unknown>> = [];

      for (const product of products) {
        const previous = previousByProduct.get(product.id);
        const available = product.reservableQuantity > 0 && ["IN_STOCK", "LOW_STOCK"].includes(product.effectiveAvailability);
        const wasAvailableMatch = Boolean(previous && ["IN_STOCK", "LOW_STOCK"].includes(previous.availability) && matchesPrice(previous.price));
        const isAvailableMatch = available && matchesPrice(product.price);
        const isChanged = !previous || previous.availability !== product.effectiveAvailability || previous.price !== product.price;
        const shouldNotify = isAvailableMatch && isChanged && !wasAvailableMatch;
        if (shouldNotify) notify.push({ name: product.name, merchant: product.merchant.businessName });
        writes.push(tx.savedSearchMatch.upsert({
          where: { savedSearchId_productId: { savedSearchId: search.id, productId: product.id } },
          create: { savedSearchId: search.id, productId: product.id, availability: product.effectiveAvailability, price: product.price, lastNotifiedAt: shouldNotify ? now : null },
          update: { availability: product.effectiveAvailability, price: product.price, ...(shouldNotify ? { lastNotifiedAt: now } : {}) },
        }));
      }
      await Promise.all(writes);
      if (notify.length) {
        const names = notify.slice(0, 3).map((item) => `${item.name} at ${item.merchant}`).join("; ");
        const more = notify.length > 3 ? `; and ${notify.length - 3} more` : "";
        await tx.notification.create({
          data: {
            recipientId: search.userId,
            type: "SAVED_SEARCH_MATCH",
            title: search.label ? `Update: ${search.label}` : `Saved search update: ${search.query}`,
            body: `${notify.length} new merchant-reported match${notify.length === 1 ? "" : "es"}: ${names}${more}. Availability may change; recheck before travelling.`,
            resourceType: "SavedSearch",
            resourceId: search.id,
          },
        });
        await tx.savedSearch.update({ where: { id: search.id }, data: { lastNotifiedAt: now } });
      }
      return notify.length > 0;
    });
    if (committed) notificationsCreated++;
  }
  return { searchesChecked: searches.length, eventsChecked, notificationsCreated };
}
