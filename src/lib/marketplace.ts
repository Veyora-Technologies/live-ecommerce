import { Prisma, type MarketplaceCategory } from "@prisma/client";
import { prisma } from "./db";
import { withReservableAvailability } from "./inventory-availability";
import { assertSafeOutboundUrl } from "./security";
import { getLegalReleaseGate, getLegalReleaseGateInTransaction, isLegalProductionMode } from "./legal";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration, getMarketMerchantWhere, getMarketProductWhere } from "./market-config";
import { MarketUnavailableError, requireOperationalMarket } from "./market-runtime";
import { isMediaPath } from "./media-path";

export const IMPLEMENTED_MARKETPLACE_WORKFLOWS = {
  PRODUCT_INVENTORY: { listingKind: "PRODUCT", transactionMode: "RESERVATION" },
  SERVICE_BOOKING: { listingKind: "SERVICE", transactionMode: "BOOKING_REQUEST" },
} as const;

export type ImplementedMarketplaceWorkflow = keyof typeof IMPLEMENTED_MARKETPLACE_WORKFLOWS;

export function isMarketplaceWorkflowImplemented(category: Pick<MarketplaceCategory, "listingKind" | "workflowKey" | "readinessStatus" | "enabledForNewListings" | "visibleInSearch" | "requiresReview" | "requiresSellerVerification">) {
  const workflow = IMPLEMENTED_MARKETPLACE_WORKFLOWS[category.workflowKey as ImplementedMarketplaceWorkflow];
  return Boolean(
    workflow &&
    workflow.listingKind === category.listingKind &&
    category.readinessStatus === "READY" &&
    category.enabledForNewListings &&
    category.visibleInSearch &&
    category.requiresReview &&
    !category.requiresSellerVerification
  );
}

export function publicMarketplaceCategoryWhere() {
  return {
    readinessStatus: "READY",
    enabledForNewListings: true,
    visibleInSearch: true,
    requiresReview: true,
    requiresSellerVerification: false,
  } as const;
}

function listingCountryWhere(countryCode: string): Prisma.MarketplaceListingWhereInput {
  return countryCode === "NG" ? { OR: [{ countryCode: "NG" }, { countryCode: null }] } : { countryCode };
}

async function marketEnabledInTransaction(tx: Prisma.TransactionClient, countryCode: string) {
  const configuration = getActiveMarketConfiguration(countryCode);
  if (!configuration) return false;
  const country = await tx.country.findUnique({
    where: { code: configuration.countryCode },
    select: { isActive: true, currencyCode: true, defaultLocale: true, defaultTimezone: true },
  });
  return Boolean(country?.isActive && country.currencyCode === configuration.defaultCurrencyCode && country.defaultLocale === configuration.defaultLocale && country.defaultTimezone === configuration.defaultTimezone);
}

export async function publicMarketplaceProductIds(productIds: string[], requestedCountryCode = DEFAULT_MARKET_CODE) {
  if (!productIds.length) return new Set<string>();
  let market;
  try { market = await requireOperationalMarket(requestedCountryCode); }
  catch (cause) { if (cause instanceof MarketUnavailableError) return new Set<string>(); throw cause; }
  const marketProductWhere = getMarketProductWhere(market.countryCode);
  const supportedCurrencies = market.supportedCurrencies.map((currency) => currency.code);
  const gate = await getLegalReleaseGate("MARKETPLACE");
  if (!gate.ready) return new Set<string>();
  const listings = await prisma.marketplaceListing.findMany({
    where: {
      productId: { in: productIds },
      currencyCode: { in: supportedCurrencies },
      AND: [listingCountryWhere(market.countryCode)],
      product: { is: { archived: false, currency: { in: supportedCurrencies }, merchant: { is: { status: "APPROVED" } }, AND: [marketProductWhere] } },
      lifecycleStatus: "PUBLISHED",
      moderationStatus: "APPROVED",
      visibility: "PUBLIC",
      transactionEligible: true,
      category: { is: publicMarketplaceCategoryWhere() },
    },
    select: {
      productId: true,
      merchantId: true,
      sellerUserId: true,
      category: { select: { listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } },
    },
  });
  let eligible = listings.filter((listing) => listing.productId && isMarketplaceWorkflowImplemented(listing.category));
  if (isLegalProductionMode()) {
    const sellerPolicy = await prisma.legalPolicy.findFirst({ where: { key: "SELLER_AGREEMENT", status: "PUBLISHED", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" }, select: { id: true } });
    const acceptances = sellerPolicy ? await prisma.legalPolicyAcceptance.findMany({ where: { policyId: sellerPolicy.id, action: "ACCEPTED", merchantId: { not: null } }, select: { userId: true, merchantId: true } }) : [];
    const acceptedPairs = new Set(acceptances.flatMap((item) => item.merchantId ? [`${item.merchantId}:${item.userId}`] : []));
    eligible = eligible.filter((listing) => Boolean(listing.productId && listing.merchantId && acceptedPairs.has(`${listing.merchantId}:${listing.sellerUserId}`)));
  }
  return new Set(eligible.flatMap((listing) => listing.productId ? [listing.productId] : []));
}

export async function isPublicMarketplaceProduct(productId: string, countryCode = DEFAULT_MARKET_CODE) {
  return (await publicMarketplaceProductIds([productId], countryCode)).has(productId);
}

export async function publicMarketplaceProductInTransaction(tx: Prisma.TransactionClient, productId: string, countryCode = DEFAULT_MARKET_CODE) {
  const market = getActiveMarketConfiguration(countryCode);
  if (!market || !await marketEnabledInTransaction(tx, countryCode)) return false;
  const supportedCurrencies = market.supportedCurrencies.map((currency) => currency.code);
  const gate = await getLegalReleaseGateInTransaction(tx, "MARKETPLACE");
  if (!gate.ready) return false;
  const listing = await tx.marketplaceListing.findFirst({
    where: { productId, currencyCode: { in: supportedCurrencies }, AND: [listingCountryWhere(countryCode)], product: { is: { archived: false, currency: { in: supportedCurrencies }, merchant: { is: { status: "APPROVED" } }, AND: [getMarketProductWhere(countryCode)] } }, lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, category: { is: publicMarketplaceCategoryWhere() } },
    select: { productId: true, merchantId: true, sellerUserId: true, category: { select: { listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } } },
  });
  return Boolean(listing?.productId && listing.merchantId && isMarketplaceWorkflowImplemented(listing.category));
}

export async function publicMarketplaceServiceIds(serviceIds: string[], requestedCountryCode = DEFAULT_MARKET_CODE) {
  if (!serviceIds.length) return new Set<string>();
  let market;
  try { market = await requireOperationalMarket(requestedCountryCode); }
  catch (cause) { if (cause instanceof MarketUnavailableError) return new Set<string>(); throw cause; }
  const marketMerchantWhere = getMarketMerchantWhere(market.countryCode);
  const gate = await getLegalReleaseGate("MARKETPLACE");
  if (!gate.ready) return new Set<string>();
  const listings = await prisma.marketplaceListing.findMany({
    where: {
      serviceId: { in: serviceIds },
      AND: [listingCountryWhere(market.countryCode)],
      service: { is: { merchant: { is: { status: "APPROVED", AND: [marketMerchantWhere] } } } },
      lifecycleStatus: "PUBLISHED",
      moderationStatus: "APPROVED",
      visibility: "PUBLIC",
      transactionEligible: true,
      category: { is: publicMarketplaceCategoryWhere() },
    },
    select: {
      serviceId: true,
      merchantId: true,
      sellerUserId: true,
      category: { select: { listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } },
    },
  });
  let eligible = listings.filter((listing) => listing.serviceId && isMarketplaceWorkflowImplemented(listing.category));
  if (isLegalProductionMode()) {
    const sellerPolicy = await prisma.legalPolicy.findFirst({ where: { key: "SELLER_AGREEMENT", status: "PUBLISHED", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" }, select: { id: true } });
    const acceptances = sellerPolicy ? await prisma.legalPolicyAcceptance.findMany({ where: { policyId: sellerPolicy.id, action: "ACCEPTED", merchantId: { not: null } }, select: { userId: true, merchantId: true } }) : [];
    const acceptedPairs = new Set(acceptances.flatMap((item) => item.merchantId ? [`${item.merchantId}:${item.userId}`] : []));
    eligible = eligible.filter((listing) => Boolean(listing.serviceId && listing.merchantId && acceptedPairs.has(`${listing.merchantId}:${listing.sellerUserId}`)));
  }
  return new Set(eligible.flatMap((listing) => listing.serviceId ? [listing.serviceId] : []));
}

export async function isPublicMarketplaceService(serviceId: string, countryCode = DEFAULT_MARKET_CODE) {
  return (await publicMarketplaceServiceIds([serviceId], countryCode)).has(serviceId);
}

export async function publicMarketplaceServiceInTransaction(tx: Prisma.TransactionClient, serviceId: string, countryCode = DEFAULT_MARKET_CODE) {
  if (!await marketEnabledInTransaction(tx, countryCode)) return false;
  const marketMerchantWhere = getMarketMerchantWhere(countryCode);
  const gate = await getLegalReleaseGateInTransaction(tx, "MARKETPLACE");
  if (!gate.ready) return false;
  const listing = await tx.marketplaceListing.findFirst({
    where: { serviceId, AND: [listingCountryWhere(countryCode)], service: { is: { merchant: { is: { status: "APPROVED", AND: [marketMerchantWhere] } } } }, lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, category: { is: publicMarketplaceCategoryWhere() } },
    select: { serviceId: true, merchantId: true, sellerUserId: true, category: { select: { listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } } },
  });
  return Boolean(listing?.serviceId && listing.merchantId && isMarketplaceWorkflowImplemented(listing.category));
}

export function safeListingImageUrl(raw: string | null | undefined) {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Images uploaded through /api/uploads are served same-origin; they are safe
  // to render but are not absolute URLs, so they are handled before URL parsing.
  if (isMediaPath(trimmed)) return trimmed;
  try {
    const url = assertSafeOutboundUrl(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

type ListingTx = Prisma.TransactionClient;

function statusForMerchant(merchantStatus: string, archived = false, existingModerationStatus?: string | null) {
  if (archived) return { lifecycleStatus: "ARCHIVED", moderationStatus: existingModerationStatus ?? "PENDING" };
  if (merchantStatus === "SUSPENDED" || merchantStatus === "REJECTED") return { lifecycleStatus: "SUSPENDED", moderationStatus: "SUSPENDED" };
  if (merchantStatus !== "APPROVED") return { lifecycleStatus: "PENDING_REVIEW", moderationStatus: "PENDING" };
  if (existingModerationStatus === "APPROVED") return { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED" };
  if (existingModerationStatus === "REJECTED") return { lifecycleStatus: "REJECTED", moderationStatus: "REJECTED" };
  if (existingModerationStatus === "SUSPENDED") return { lifecycleStatus: "SUSPENDED", moderationStatus: "SUSPENDED" };
  return { lifecycleStatus: "PENDING_REVIEW", moderationStatus: "PENDING" };
}

function productAvailability(stock: number, reserved: number, lastConfirmedAt: Date | null, blockedBatchQuantity = 0) {
  if (Math.max(0, stock - reserved - blockedBatchQuantity) <= 0) return { availabilityState: "UNAVAILABLE", availabilityConfirmedAt: lastConfirmedAt };
  const ageHours = lastConfirmedAt ? (Date.now() - lastConfirmedAt.getTime()) / 3_600_000 : Infinity;
  return ageHours <= 24
    ? { availabilityState: "AVAILABLE", availabilityConfirmedAt: lastConfirmedAt }
    : { availabilityState: "UNKNOWN", availabilityConfirmedAt: lastConfirmedAt };
}

async function readyCategory(tx: ListingTx, slug: string, listingKind: "PRODUCT" | "SERVICE") {
  const category = await tx.marketplaceCategory.findUnique({ where: { slug } });
  if (!category || category.listingKind !== listingKind || !isMarketplaceWorkflowImplemented(category)) {
    throw new Error(`Marketplace category workflow '${slug}' is not configured and enabled.`);
  }
  return category;
}

async function syncPrimaryMedia(tx: ListingTx, listingId: string, rawUrl: string | null | undefined, altText: string) {
  const url = safeListingImageUrl(rawUrl);
  const existing = await tx.marketplaceListingMedia.findFirst({ where: { listingId, isPrimary: true } });
  if (!url) {
    if (existing) await tx.marketplaceListingMedia.delete({ where: { id: existing.id } });
    return;
  }
  if (existing?.url === url) return;
  if (existing) {
    await tx.marketplaceListingMedia.update({ where: { id: existing.id }, data: { url, altText } });
    return;
  }
  await tx.marketplaceListingMedia.create({ data: { listingId, mediaType: "IMAGE", url, altText, isPrimary: true, sortOrder: 0 } });
}

/**
 * Creates or refreshes the common marketplace projection for an existing Product.
 * Product remains the typed inventory/price source of truth; the shared row supplies
 * category, lifecycle, search, moderation, media, and transaction-mode metadata.
 */
export async function syncProductMarketplaceListing(tx: ListingTx, productId: string, actorId?: string, options: { contentChanged?: boolean } = {}) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: {
      merchant: { select: { id: true, ownerId: true, organizationId: true, status: true, countryCode: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true } },
      branch: { select: { id: true, countryCode: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true } },
    },
  });
  if (!product) return null;
  const category = await readyCategory(tx, "products", "PRODUCT");
  const batches = await tx.productBatch.findMany({ where: { productId: product.id }, select: { quantity: true, status: true, expiresAt: true } });
  const now = Date.now();
  const blockedBatchQuantity = batches.filter((batch) => batch.status !== "ACTIVE" || Boolean(batch.expiresAt && batch.expiresAt.getTime() < now)).reduce((total, batch) => total + batch.quantity, 0);
  const availability = productAvailability(product.stockQuantity, product.reservedQuantity, product.lastConfirmedAt, blockedBatchQuantity);
  const existing = await tx.marketplaceListing.findUnique({
    where: { productId: product.id },
    include: { media: { where: { isPrimary: true }, select: { url: true }, take: 1 } },
  });
  const contentChanged = Boolean(options.contentChanged || (existing && (
    existing.title !== product.name ||
    existing.description !== product.description ||
    existing.priceAmountMinor !== BigInt(product.price) ||
    existing.currencyCode !== (product.currency || "NGN") ||
    existing.priceUnit !== (product.unit || "EACH") ||
    existing.media[0]?.url !== safeListingImageUrl(product.imageUrl)
  )));
  const existingModerationStatus = contentChanged && ["APPROVED", "REJECTED"].includes(existing?.moderationStatus ?? "") ? "PENDING" : existing?.moderationStatus;
  const status = statusForMerchant(product.merchant.status, product.archived, existingModerationStatus);
  const data = {
    sellerUserId: product.merchant.ownerId,
    merchantId: product.merchantId,
    organizationId: product.merchant.organizationId,
    branchId: product.branchId,
    categoryId: category.id,
    listingKind: "PRODUCT",
    title: product.name,
    description: product.description,
    priceModel: "FIXED",
    priceAmountMinor: BigInt(product.price),
    currencyCode: product.currency || "NGN",
    priceUnit: product.unit || "EACH",
    ...availability,
    transactionMode: "RESERVATION",
    ...status,
    visibility: "PUBLIC",
    transactionEligible: status.lifecycleStatus === "PUBLISHED",
    schemaVersion: category.schemaVersion,
    publishedAt: status.lifecycleStatus === "PUBLISHED" ? (existing?.publishedAt ?? new Date()) : null,
    countryCode: product.branch?.countryCode ?? product.merchant.countryCode,
    stateCode: product.branch?.stateCode ?? product.merchant.stateCode,
    lgaCode: product.branch?.lgaCode ?? product.merchant.lgaCode,
    cityCode: product.branch?.cityCode ?? product.merchant.cityCode,
    localityCode: product.branch?.localityCode ?? product.merchant.localityCode,
  };
  const listing = await tx.marketplaceListing.upsert({
    where: { productId: product.id },
    create: { ...data, productId: product.id },
    update: data,
  });
  await syncPrimaryMedia(tx, listing.id, product.imageUrl, product.name);
  if (!existing) {
    await tx.marketplaceListingEvent.create({ data: { listingId: listing.id, actorId: actorId ?? product.merchant.ownerId, eventType: "LISTING_INDEXED", toStatus: listing.lifecycleStatus } });
  } else if (existing.lifecycleStatus !== listing.lifecycleStatus || existing.moderationStatus !== listing.moderationStatus) {
    await tx.marketplaceListingEvent.create({ data: { listingId: listing.id, actorId, eventType: "LISTING_STATUS_SYNCED", fromStatus: existing.lifecycleStatus, toStatus: listing.lifecycleStatus, reason: "Source product or moderation state changed; listing requires review" } });
  }
  return listing;
}

/**
 * Creates or refreshes the common marketplace projection for an existing Service.
 * Service remains the typed appointment/booking source of truth.
 */
export async function syncServiceMarketplaceListing(tx: ListingTx, serviceId: string, actorId?: string) {
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    include: { merchant: { select: { id: true, ownerId: true, organizationId: true, status: true, countryCode: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true } } },
  });
  if (!service) return null;
  const category = await readyCategory(tx, "services", "SERVICE");
  const existing = await tx.marketplaceListing.findUnique({ where: { serviceId: service.id } });
  const status = statusForMerchant(service.merchant.status, false, existing?.moderationStatus);
  const listing = await tx.marketplaceListing.upsert({
    where: { serviceId: service.id },
    create: {
      sellerUserId: service.merchant.ownerId,
      merchantId: service.merchantId,
      organizationId: service.merchant.organizationId,
      categoryId: category.id,
      listingKind: "SERVICE",
      serviceId: service.id,
      title: service.name,
      description: service.description,
      priceModel: service.price === null ? "QUOTE" : "FIXED",
      priceAmountMinor: service.price === null ? null : BigInt(service.price),
      currencyCode: "NGN",
      priceUnit: "SESSION",
      availabilityState: "UNKNOWN",
      availabilityConfirmedAt: null,
      transactionMode: "BOOKING_REQUEST",
      ...status,
      visibility: "PUBLIC",
      transactionEligible: status.lifecycleStatus === "PUBLISHED",
      schemaVersion: category.schemaVersion,
      publishedAt: status.lifecycleStatus === "PUBLISHED" ? new Date() : null,
      countryCode: service.merchant.countryCode,
      stateCode: service.merchant.stateCode,
      lgaCode: service.merchant.lgaCode,
      cityCode: service.merchant.cityCode,
      localityCode: service.merchant.localityCode,
    },
    update: {
      sellerUserId: service.merchant.ownerId,
      merchantId: service.merchantId,
      organizationId: service.merchant.organizationId,
      categoryId: category.id,
      listingKind: "SERVICE",
      title: service.name,
      description: service.description,
      priceModel: service.price === null ? "QUOTE" : "FIXED",
      priceAmountMinor: service.price === null ? null : BigInt(service.price),
      currencyCode: "NGN",
      priceUnit: "SESSION",
      transactionMode: "BOOKING_REQUEST",
      availabilityState: "UNKNOWN",
      availabilityConfirmedAt: null,
      ...status,
      visibility: "PUBLIC",
      transactionEligible: status.lifecycleStatus === "PUBLISHED",
      schemaVersion: category.schemaVersion,
      publishedAt: status.lifecycleStatus === "PUBLISHED" ? (existing?.publishedAt ?? new Date()) : null,
      countryCode: service.merchant.countryCode,
      stateCode: service.merchant.stateCode,
      lgaCode: service.merchant.lgaCode,
      cityCode: service.merchant.cityCode,
      localityCode: service.merchant.localityCode,
    },
  });
  if (!existing) {
    await tx.marketplaceListingEvent.create({ data: { listingId: listing.id, actorId: actorId ?? service.merchant.ownerId, eventType: "LISTING_INDEXED", toStatus: listing.lifecycleStatus } });
  } else if (existing.lifecycleStatus !== listing.lifecycleStatus || existing.moderationStatus !== listing.moderationStatus) {
    await tx.marketplaceListingEvent.create({ data: { listingId: listing.id, actorId, eventType: "LISTING_STATUS_SYNCED", fromStatus: existing.lifecycleStatus, toStatus: listing.lifecycleStatus, reason: "Merchant or source-service lifecycle changed" } });
  }
  return listing;
}

const PUBLIC_LISTING_SELECT = {
  id: true,
  merchantId: true,
  sellerUserId: true,
  listingKind: true,
  title: true,
  description: true,
  priceModel: true,
  priceAmountMinor: true,
  currencyCode: true,
  priceUnit: true,
  availabilityState: true,
  availabilityConfirmedAt: true,
  transactionMode: true,
  updatedAt: true,
  category: { select: { slug: true, name: true, listingKind: true } },
  merchant: { select: { id: true, businessName: true, category: true, area: true, city: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true } },
  branch: { select: { id: true, name: true, area: true, city: true, stateCode: true, lgaCode: true, cityCode: true, localityCode: true } },
  media: { where: { isPrimary: true }, select: { url: true, altText: true }, take: 1 },
  product: { select: { id: true, category: true, brand: true, unit: true, availability: true, stockQuantity: true, reservedQuantity: true, lowStockThreshold: true, lastConfirmedAt: true, archived: true } },
  service: { select: { id: true, durationMin: true, capacity: true } },
} satisfies Prisma.MarketplaceListingSelect;

export async function searchPublicMarketplaceListings(input: {
  query?: string;
  categorySlug?: string;
  countryCode?: string;
  locationFilter?: Awaited<ReturnType<typeof import("./geography").getGeographicScopeFilter>>;
  limit?: number;
}) {
  const market = await requireOperationalMarket(input.countryCode || DEFAULT_MARKET_CODE);
  if (input.locationFilter && input.locationFilter.countryCode !== market.countryCode) {
    throw new MarketUnavailableError("Selected location does not belong to this market.", 400);
  }
  const marketProductWhere = getMarketProductWhere(market.countryCode);
  const marketMerchantWhere = getMarketMerchantWhere(market.countryCode);
  const supportedCurrencies = market.supportedCurrencies.map((currency) => currency.code);
  const legalGate = await getLegalReleaseGate("MARKETPLACE");
  if (!legalGate.ready) return { listings: [], categoryUnavailable: false, legalGate };
  const query = (input.query ?? "").trim().slice(0, 120);
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1).slice(0, 6);
  const limit = Math.max(1, Math.min(input.limit ?? 30, 60));
  const locationFilter = input.locationFilter;
  const locationPredicate: Prisma.MarketplaceListingWhereInput = locationFilter?.codes.length ? {
    OR: [
      { product: { is: { merchant: { is: { status: "APPROVED", ...locationFilter.where } } } } },
      { product: { is: { merchant: { is: { status: "APPROVED" } }, branch: { is: locationFilter.where } } } },
      { service: { is: { merchant: { is: { status: "APPROVED", ...locationFilter.where } } } } },
    ],
  } : {};

  const categoryRows = await prisma.marketplaceCategory.findMany({ where: publicMarketplaceCategoryWhere() });
  const activeCategories = categoryRows.filter(isMarketplaceWorkflowImplemented);
  const activeCategoryIds = activeCategories.map((item) => item.id);
  const category = input.categorySlug ? activeCategories.find((item) => item.slug === input.categorySlug) ?? null : null;
  if (input.categorySlug && !category) return { listings: [], categoryUnavailable: true, legalGate };
  if (!activeCategoryIds.length) return { listings: [], categoryUnavailable: false, legalGate };

  const textPredicates: Prisma.MarketplaceListingWhereInput[] = terms.map((term) => ({
    OR: [
      { title: { contains: term } },
      { description: { contains: term } },
      { product: { is: { OR: [{ name: { contains: term } }, { brand: { contains: term } }, { category: { contains: term } }] } } },
      { service: { is: { OR: [{ name: { contains: term } }, { description: { contains: term } }] } } },
    ],
  }));
  const andPredicates = [
    listingCountryWhere(market.countryCode),
    ...textPredicates,
    ...(locationFilter?.codes.length ? [locationPredicate] : []),
  ];

  const publicWhere: Prisma.MarketplaceListingWhereInput = {
    currencyCode: { in: supportedCurrencies },
    lifecycleStatus: "PUBLISHED",
    moderationStatus: "APPROVED",
    visibility: "PUBLIC",
    transactionEligible: true,
    categoryId: category ? category.id : { in: activeCategoryIds },
    OR: [
      { product: { is: { archived: false, currency: { in: supportedCurrencies }, merchant: { is: { status: "APPROVED" } }, AND: [marketProductWhere] } } },
      { service: { is: { merchant: { is: { status: "APPROVED", AND: [marketMerchantWhere] } } } } },
    ],
    ...(andPredicates.length ? { AND: andPredicates } : {}),
  };

  const rawRows = await prisma.marketplaceListing.findMany({
    where: publicWhere,
    select: PUBLIC_LISTING_SELECT,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
  });
  let rows = rawRows;
  if (isLegalProductionMode()) {
    const sellerPolicy = await prisma.legalPolicy.findFirst({ where: { key: "SELLER_AGREEMENT", status: "PUBLISHED", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" }, select: { id: true } });
    const acceptances = sellerPolicy ? await prisma.legalPolicyAcceptance.findMany({ where: { policyId: sellerPolicy.id, action: "ACCEPTED", merchantId: { not: null } }, select: { userId: true, merchantId: true } }) : [];
    const acceptedPairs = new Set(acceptances.flatMap((item) => item.merchantId ? [`${item.merchantId}:${item.userId}`] : []));
    rows = rawRows.filter((listing) => Boolean(listing.merchantId && acceptedPairs.has(`${listing.merchantId}:${listing.sellerUserId}`)));
  }
  const inventoryRows = await withReservableAvailability(rows.flatMap((listing) => listing.product ? [listing.product] : []));
  const availabilityByProduct = new Map(inventoryRows.map((product) => [product.id, product.reservableQuantity]));
  const listings = rows.map((listing) => {
    const media = listing.media.flatMap((item) => {
      const url = safeListingImageUrl(item.url);
      return url ? [{ ...item, url }] : [];
    });
    const sanitizedListing = {
      id: listing.id,
      listingKind: listing.listingKind,
      title: listing.title,
      description: listing.description,
      priceModel: listing.priceModel,
      priceAmountMinor: listing.priceAmountMinor,
      currencyCode: listing.currencyCode,
      priceUnit: listing.priceUnit,
      availabilityState: listing.availabilityState,
      availabilityConfirmedAt: listing.availabilityConfirmedAt,
      transactionMode: listing.transactionMode,
      updatedAt: listing.updatedAt,
      category: listing.category,
      merchant: listing.merchant,
      branch: listing.branch,
      media,
      product: listing.product,
      service: listing.service,
    };
    if (!listing.product) return sanitizedListing;
    const availableQuantity = availabilityByProduct.get(listing.product.id) ?? 0;
    const availability = productAvailability(availableQuantity, 0, listing.product.lastConfirmedAt);
    const publicProduct = {
      id: listing.product.id,
      category: listing.product.category,
      brand: listing.product.brand,
      unit: listing.product.unit,
      availability: listing.product.availability,
      lastConfirmedAt: listing.product.lastConfirmedAt,
      archived: listing.product.archived,
    };
    return { ...sanitizedListing, ...availability, product: publicProduct };
  });
  return { listings, categoryUnavailable: false, legalGate };
}

export function marketplaceListingJson<T extends { priceAmountMinor: bigint | null }>(listing: T) {
  return { ...listing, priceAmountMinor: listing.priceAmountMinor === null ? null : listing.priceAmountMinor.toString() };
}
