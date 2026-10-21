import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LocationScope } from "@/lib/geography";
import { getLegalReleaseGate } from "@/lib/legal";
import { publicMarketplaceCategoryWhere, publicMarketplaceServiceIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketBranchWhere, getMarketMerchantWhere } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

export type UnifiedSearchTerms = {
  businesses: any[];
  services: any[];
  activity: Array<{
    id: string;
    type: "reservation" | "service_booking" | "item_request" | "saved_item" | "saved_search" | "shopping_list";
    title: string;
    subtitle: string;
    status: string;
    href: string;
    updatedAt: Date;
  }>;
};

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "any", "around", "at", "available", "below", "business", "businesses", "can", "compare", "cost", "costs", "do", "find", "for", "from", "have", "in", "listings", "me", "near", "of", "please", "price", "prices", "product", "products", "search", "service", "services", "show", "store", "stores", "the", "to", "under", "what", "where", "with",
]);
const ACTIVITY_WORDS = /\b(my|mine|reservation|reservations|order|orders|booking|bookings|appointment|appointments|request|requests|quote|quotes|saved|list|lists|activity|purchase|purchases)\b/i;

/** Small, deterministic tokenizer used by the shared search layer; never sends data to an external model. */
export function extractUniversalSearchTerms(query: string): string[] {
  const normalized = query.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.filter((token) => token.length > 1 && /\p{L}/u.test(token) && !SEARCH_STOP_WORDS.has(token)))].slice(0, 6);
}

export function isActivityFocusedQuery(query: string): boolean {
  return ACTIVITY_WORDS.test(query);
}

function textWhere(fields: string[], terms: string[]) {
  if (!terms.length) return {};
  return { OR: fields.flatMap((field) => terms.map((term) => ({ [field]: { contains: term } }))) };
}

function termsForActivity(query: string, terms: string[]) {
  if (!isActivityFocusedQuery(query)) return terms;
  return terms.filter((term) => !["my", "mine", "reservation", "reservations", "order", "orders", "booking", "bookings", "appointment", "appointments", "request", "requests", "quote", "quotes", "saved", "list", "lists", "activity", "purchase", "purchases"].includes(term));
}

/**
 * Search public business/service records and only the requesting user's own saved/activity records.
 * Public groups honour the same validated geography filter as product search; personal groups are
 * intentionally account-wide so a selected public search area cannot hide the user's own records.
 */
export async function searchUnifiedRelated(input: {
  query: string;
  userId?: string | null;
  locationFilter: Awaited<ReturnType<typeof import("@/lib/geography").getGeographicScopeFilter>>;
  countryCode?: string;
  locationScope: LocationScope;
  locationUnavailable?: boolean;
  limit?: number;
}): Promise<UnifiedSearchTerms> {
  const query = input.query.trim().slice(0, 200);
  const limit = Math.max(1, Math.min(input.limit ?? 6, 10));
  const terms = extractUniversalSearchTerms(query);
  const empty: UnifiedSearchTerms = { businesses: [], services: [], activity: [] };
  if (query.length < 2) return empty;

  const marketCode = input.countryCode || DEFAULT_MARKET_CODE;
  let marketEnabled = false;
  let marketMerchantWhere: Prisma.MerchantWhereInput = { id: { in: [] } };
  let marketBranchWhere: Prisma.BranchWhereInput = { id: { in: [] } };
  try {
    await requireOperationalMarket(marketCode);
    marketMerchantWhere = getMarketMerchantWhere(marketCode);
    marketBranchWhere = getMarketBranchWhere(marketCode);
    marketEnabled = true;
  } catch (cause) {
    if (!(cause instanceof MarketUnavailableError)) throw cause;
  }
  const publicSearchAllowed = !input.locationUnavailable && marketEnabled;
  const marketplaceGate = await getLegalReleaseGate("MARKETPLACE");
  const hasLocation = input.locationFilter.codes.length > 0;
  const merchantLocationWhere = hasLocation
    ? { OR: [input.locationFilter.where, { branches: { some: input.locationFilter.where } }] }
    : {};
  const branchLocationWhere = hasLocation
    ? { AND: [marketBranchWhere, input.locationFilter.where] }
    : marketBranchWhere;
  const businessText = textWhere(["businessName", "category", "description"], terms);
  const serviceText = textWhere(["name", "description"], terms);
  const activityTerms = termsForActivity(query, terms);
  const activityWordOnly = isActivityFocusedQuery(query) && activityTerms.length === 0;
  const activityOr = activityTerms.length ? activityTerms : undefined;

  let businesses: any[] = [];
  let services: any[] = [];
  if (publicSearchAllowed && terms.length) {
    [businesses, services] = await Promise.all([
      prisma.merchant.findMany({
        where: { status: "APPROVED", AND: [marketMerchantWhere, merchantLocationWhere, businessText] },
        select: {
          id: true, businessName: true, category: true, description: true, area: true, city: true,
          stateCode: true, lgaCode: true, cityCode: true, localityCode: true, storeStatus: true, verificationStatus: true,
          state: { select: { code: true, name: true, type: true } },
          lga: { select: { code: true, name: true, type: true } },
          cityArea: { select: { code: true, name: true, type: true } },
          branches: {
            where: branchLocationWhere,
            select: {
              id: true, name: true, area: true, city: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true, storeStatus: true,
              state: { select: { code: true, name: true, type: true } },
              lga: { select: { code: true, name: true, type: true } },
              cityArea: { select: { code: true, name: true, type: true } },
            },
            take: 2,
          },
        },
        orderBy: { updatedAt: "desc" }, take: limit,
      }),
      // Services are currently merchant-scoped, not branch-scoped. Do not infer availability
      // at a branch merely because the same merchant has a branch there.
      marketplaceGate.ready ? prisma.service.findMany({
        where: {
          merchant: { status: "APPROVED", AND: [marketMerchantWhere, ...(hasLocation ? [input.locationFilter.where] : [])] },
          marketplaceListing: { is: { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, category: { is: publicMarketplaceCategoryWhere() } } },
          ...serviceText,
        },
        select: {
          id: true, name: true, description: true, price: true, durationMin: true, capacity: true,
          merchant: { select: { id: true, businessName: true, category: true, area: true, city: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true, storeStatus: true, state: { select: { code: true, name: true, type: true } }, lga: { select: { code: true, name: true, type: true } }, cityArea: { select: { code: true, name: true, type: true } } } },
        },
        orderBy: { updatedAt: "desc" }, take: limit,
      }) : Promise.resolve([]),
    ]);
    const publicServiceIds = await publicMarketplaceServiceIds(services.map((service) => service.id));
    services = services.filter((service) => publicServiceIds.has(service.id));
  }

  const activity: UnifiedSearchTerms["activity"] = [];
  if (input.userId) {
    const [reservations, bookings, requests, quotes, savedItems, savedSearches, lists] = await Promise.all([
      prisma.reservation.findMany({
        where: { consumerId: input.userId, ...(activityOr ? { OR: activityOr.flatMap((term) => [{ code: { contains: term } }, { product: { name: { contains: term } } }, { merchant: { businessName: { contains: term } } }]) } : {}) },
        select: { id: true, code: true, status: true, updatedAt: true, product: { select: { name: true } }, merchant: { select: { businessName: true } } },
        orderBy: { updatedAt: "desc" }, take: limit,
      }),
      prisma.serviceBooking.findMany({
        where: { consumerId: input.userId, ...(activityOr ? { OR: activityOr.flatMap((term) => [{ service: { name: { contains: term } } }, { merchant: { businessName: { contains: term } } }]) } : {}) },
        select: { id: true, status: true, updatedAt: true, service: { select: { name: true } }, merchant: { select: { businessName: true } } },
        orderBy: { updatedAt: "desc" }, take: limit,
      }),
      prisma.itemRequest.findMany({
        where: { requesterId: input.userId, ...(activityOr ? { OR: activityOr.flatMap((term) => [{ productName: { contains: term } }, { category: { contains: term } }, { brand: { contains: term } }]) } : {}) },
        select: { id: true, productName: true, status: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit,
      }),
      prisma.itemRequestResponse.findMany({
        where: { request: { requesterId: input.userId }, ...(activityOr ? { OR: activityOr.flatMap((term) => [{ message: { contains: term } }, { merchant: { businessName: { contains: term } } }, { request: { productName: { contains: term } } }]) } : {}) },
        select: { id: true, status: true, createdAt: true, message: true, merchant: { select: { businessName: true } }, request: { select: { productName: true } } },
        orderBy: { createdAt: "desc" }, take: limit,
      }),
      prisma.savedItem.findMany({
        where: { userId: input.userId, productId: { not: null }, ...(activityOr ? { product: { OR: activityOr.flatMap((term) => [{ name: { contains: term } }, { brand: { contains: term } }, { category: { contains: term } }]) } } : {}) },
        select: { id: true, createdAt: true, product: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: limit,
      }),
      prisma.savedSearch.findMany({
        where: { userId: input.userId, ...(activityOr ? { OR: activityOr.flatMap((term) => [{ query: { contains: term } }, { label: { contains: term } }]) } : {}) },
        select: { id: true, query: true, label: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit,
      }),
      prisma.shoppingList.findMany({
        where: { AND: [{ OR: [{ ownerId: input.userId }, { members: { some: { userId: input.userId } } }] }, ...(activityOr ? [textWhere(["name", "description"], activityOr)] : [])] },
        select: { id: true, name: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit,
      }),
    ]);

    reservations.forEach((item) => activity.push({ id: item.id, type: "reservation", title: item.product.name, subtitle: `${item.merchant.businessName} · ${item.code}`, status: item.status, href: "/activity", updatedAt: item.updatedAt }));
    bookings.forEach((item) => activity.push({ id: item.id, type: "service_booking", title: item.service.name, subtitle: item.merchant.businessName, status: item.status, href: "/activity", updatedAt: item.updatedAt }));
    requests.forEach((item) => activity.push({ id: item.id, type: "item_request", title: item.productName, subtitle: "Your item request", status: item.status, href: "/requests", updatedAt: item.updatedAt }));
    quotes.forEach((item) => activity.push({ id: item.id, type: "item_request", title: `Quote: ${item.request.productName}`, subtitle: `${item.merchant?.businessName || "Merchant"} · ${item.message}`, status: item.status, href: "/requests", updatedAt: item.createdAt }));
    savedItems.forEach((item) => { if (item.product) activity.push({ id: item.id, type: "saved_item", title: item.product.name, subtitle: "Saved product", status: "SAVED", href: `/product/${item.product.id}`, updatedAt: item.createdAt }); });
    savedSearches.forEach((item) => activity.push({ id: item.id, type: "saved_search", title: item.label || item.query, subtitle: "Saved search", status: "SAVED", href: `/search?q=${encodeURIComponent(item.query)}`, updatedAt: item.createdAt }));
    lists.forEach((item) => activity.push({ id: item.id, type: "shopping_list", title: item.name, subtitle: "Shopping list", status: "PLANNING", href: `/lists/${item.id}`, updatedAt: item.updatedAt }));

    activity.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // Suppress broad personal results for an ordinary product query. Activity is searchable when
  // there is a matching term; activity-intent queries such as “my reservations” show recent items.
  const activityResults = input.userId && (activityTerms.length || activityWordOnly) ? activity.slice(0, limit) : [];
  return { businesses, services, activity: activityResults };
}
