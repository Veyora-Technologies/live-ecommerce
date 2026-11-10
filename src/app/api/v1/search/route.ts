import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { haversine } from "@/lib/utils";
import { parseNaturalQuery, expandQueryWithSynonyms } from "@/lib/nlp";
import { semanticSearch, explainResult } from "@/lib/semantic";
import { recordSearchDemand } from "@/lib/insights";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { GeographyRequestError, getGeographicProductWhere, getGeographicScopeFilter, resolveLocationFromText, type LocationScope } from "@/lib/geography";
import { merchantLocationLabel } from "@/lib/location-label";
import { getCurrentUser } from "@/lib/auth";
import { searchUnifiedRelated } from "@/lib/unified-search";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { getLegalReleaseGate } from "@/lib/legal";
import { DEFAULT_MARKET_CODE, getMarketProductWhere, isMarketIntegrationReady, productBelongsToMarket } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";
import { parseMajorAmountToMinor } from "@/lib/money";

export async function GET(req: NextRequest){ return POST(req); }

export async function POST(req: NextRequest){
  const legalGate = await getLegalReleaseGate("MARKETPLACE");
  if (!legalGate.ready) return NextResponse.json({ error: legalGate.publicMessage, code: "LEGAL_RELEASE_GATE", results: [], total: 0 }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const url = new URL(req.url);
  let body:any={};
  try{ body = await req.json(); } catch{}
  const requestedCountryCode = url.searchParams.get("countryCode") || (typeof body.countryCode === "string" ? body.countryCode : DEFAULT_MARKET_CODE);
  let market;
  try { market = await requireOperationalMarket(requestedCountryCode); }
  catch (cause) {
    const status = cause instanceof MarketUnavailableError ? cause.status : 503;
    const message = cause instanceof Error ? cause.message : "This market is unavailable.";
    return NextResponse.json({ error: message, code: "MARKET_UNAVAILABLE", results: [], total: 0 }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const countryCode = market.countryCode;
  const rawQ = (url.searchParams.get("q") || body.q || "").trim();
  const areaParam = url.searchParams.get("area") || body.area || ""; // legacy free-text merchant locality filter
  const bodyCodes = Array.isArray(body.locationCodes) ? body.locationCodes.filter((code: unknown): code is string => typeof code === "string") : [];
  const locationCodes = [...url.searchParams.getAll("locationCode"), ...url.searchParams.getAll("locationCodes"), ...bodyCodes,
    ...(typeof body.locationCode === "string" ? [body.locationCode] : [])].filter(Boolean);
  const explicitLocationSelection = url.searchParams.has("scope") || body.scope !== undefined || locationCodes.length > 0 || Boolean(areaParam);
  const scopeParam = url.searchParams.get("scope") || body.scope || (locationCodes.length ? "admin" : "nationwide");
  const allowedScopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
  if (typeof scopeParam !== "string" || !allowedScopes.includes(scopeParam as LocationScope)) {
    return NextResponse.json({ error: "Choose a supported location scope" }, { status: 400 });
  }
  let locationScope = scopeParam as LocationScope;
  let locationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>>;
  try {
locationFilter = await getGeographicScopeFilter(locationCodes, locationScope, countryCode);
  } catch (cause) {
    if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    throw cause;
  }
  const categoryParam = url.searchParams.get("category") || body.category || "";
  const inStock = url.searchParams.get("inStock") || body.inStock;
  const openNow = url.searchParams.get("openNow") || body.openNow;
  const pickup = url.searchParams.get("pickup") || body.pickup;
  const delivery = url.searchParams.get("delivery") || body.delivery;
  const verified = url.searchParams.get("verified") || body.verified;
  const maxPriceParam = url.searchParams.get("maxPrice") || body.maxPrice;
  const minPriceParam = url.searchParams.get("minPrice") || body.minPrice;
  const sort = url.searchParams.get("sort") || body.sort || "relevance";
  const lat = parseFloat(url.searchParams.get("lat")|| body.lat || "");
  const lng = parseFloat(url.searchParams.get("lng")|| body.lng || "");
  const page = parseInt(url.searchParams.get("page")|| body.page || "1");
  const pageSize = Math.min(50, parseInt(url.searchParams.get("pageSize")|| body.pageSize || "20"));
  const useNLP = url.searchParams.get("nlp") !== "false"; // allow disable

  // Natural language parsing
  let parsed: any = null;
  let q = rawQ;
  let area = areaParam;
  let category = categoryParam;
  let maxPrice = maxPriceParam;
  let minPrice = minPriceParam;
  let distanceKm: number | undefined;
  let inferredLocation: Awaited<ReturnType<typeof resolveLocationFromText>> = null;
  let locationScopeNotice = "";

  if (rawQ && useNLP) {
    parsed = parseNaturalQuery(rawQ);
    // Use parsed to fill missing filters (explicit params take precedence)
    if (!area && parsed.area) area = parsed.area;
    if (!category && parsed.category) category = parsed.category;
    if (!maxPrice && parsed.maxPrice !== undefined) maxPrice = String(parsed.maxPrice);
    if (!minPrice && parsed.minPrice !== undefined) minPrice = String(parsed.minPrice);
    if (parsed.distanceKm) distanceKm = parsed.distanceKm;
    // if parsed q is substantially different, use it
    if (parsed.q && parsed.q.length > 2 && parsed.q !== rawQ.toLowerCase()) {
      q = parsed.q;
    }
  }

  if (rawQ && useNLP) {
    inferredLocation = await resolveLocationFromText(rawQ, countryCode).catch(() => null);
    if (inferredLocation) {
      const cleanParsed = parseNaturalQuery(inferredLocation.cleanedQuery);
      parsed = cleanParsed;
      q = cleanParsed.q;
      if (!category && cleanParsed.category) category = cleanParsed.category;
      if (!maxPrice && cleanParsed.maxPrice !== undefined) maxPrice = String(cleanParsed.maxPrice);
      if (!minPrice && cleanParsed.minPrice !== undefined) minPrice = String(cleanParsed.minPrice);
      if (cleanParsed.distanceKm) distanceKm = cleanParsed.distanceKm;
      if (!area && cleanParsed.area) area = cleanParsed.area;

      if (!explicitLocationSelection && !locationCodes.length) {
        locationCodes.push(inferredLocation.area.code);
        locationScope = "admin";
        try { locationFilter = await getGeographicScopeFilter(locationCodes, locationScope, countryCode); }
        catch (cause) {
          if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
          throw cause;
        }
      } else if (!locationFilter.codes.includes(inferredLocation.area.code)) {
        locationScopeNotice = `Your search phrase mentions ${inferredLocation.area.name}; results still use the explicitly selected ${locationScope} scope.`;
      }
    }
  }

  if (parsed?.priceFilterInvalid) {
    return NextResponse.json({ error: "The natural-language price filter could not be read safely. Use a valid whole-Naira amount.", code: "INVALID_PRICE_FILTER" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const deliveryRequested = delivery === "true" || delivery === true || parsed?.delivery === true;
  if (deliveryRequested && !isMarketIntegrationReady(countryCode, "deliveryIntegrations")) {
    return NextResponse.json({ error: "Delivery search is unavailable because Furnivo has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED", results: [], total: 0 }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  // Record demand for analytics (aggregated, privacy-safe)
  if (q) await recordSearchDemand(q, category, inferredLocation?.area.name || area).catch(()=>{});

  // Build where
  const locationProductWhere = getGeographicProductWhere(locationFilter);
  const marketProductWhere = getMarketProductWhere(countryCode);
  const allowedCurrencies = new Set(market.supportedCurrencies.map((currency) => currency.code));
  const where:any = { archived:false, AND:[locationProductWhere, marketProductWhere] };
  // Semantic expansion: we will use semanticSearch instead of simple OR when q present
  let products: any[] = [];
  let semanticCandidatesUsed = false;

  if (q) {
    // Try semantic search first
    const semanticFilters:any = {};
    if (category) semanticFilters.category = category;
    if (inStock==="true" || inStock===true || parsed?.inStock) semanticFilters.inStock = true;
    const semanticResults = await semanticSearch(q, semanticFilters);
    // If semantic returns results, use them; otherwise fallback to contains
    if (semanticResults.length > 0) {
      products = semanticResults as any[];
      semanticCandidatesUsed = true;
    } else {
      const expansions = expandQueryWithSynonyms(q);
      const termWhere = { OR: expansions.flatMap(term=>[
        { name: { contains: term } },
        { brand: { contains: term } },
        { category: { contains: term } },
        { merchant: { businessName: { contains: term } } },
      ]) };
      products = await prisma.product.findMany({ where: { archived:false, AND:[locationProductWhere, marketProductWhere, termWhere] }, include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:100, orderBy:{ updatedAt:"desc"}});
    }
  } else {
    // no q, just filters
    if (category) where.category = category;
    if (inStock==="true" || inStock===true) where.availability = { in: ["IN_STOCK","LOW_STOCK"]};
    if (area && area!=="All areas" && !area.includes("All areas")) {
      const clean = area.replace("Abuja • ","").trim();
      where.merchant = { ...(where.merchant||{}), area: clean };
    }
    products = await prisma.product.findMany({ where, include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:100, orderBy:{ updatedAt:"desc"}});
  }

  // Semantic search may return a broader candidate set; apply the validated location scope again.
  products = products.filter((product) => productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market.defaultCurrencyCode));
  if (locationScope !== "nationwide") {
    const validCodes = new Set(locationFilter.codes);
    products = products.filter((product) => productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market.defaultCurrencyCode) && [product.merchant?.stateCode, product.merchant?.lgaCode, product.merchant?.cityCode, product.merchant?.localityCode, product.branch?.stateCode, product.branch?.lgaCode, product.branch?.cityCode, product.branch?.localityCode].some((code) => code && validCodes.has(code)));
    if (semanticCandidatesUsed && q && products.length === 0) {
      const expansions = expandQueryWithSynonyms(q);
      const termWhere = { OR: expansions.flatMap(term=>[
        { name: { contains: term } }, { brand: { contains: term } }, { category: { contains: term } }, { merchant: { businessName: { contains: term } } },
      ]) };
      products = await prisma.product.findMany({ where: { archived:false, AND:[locationProductWhere, marketProductWhere, termWhere] }, include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:100, orderBy:{ updatedAt:"desc"}});
      products = products.filter((product) => productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market.defaultCurrencyCode) && [product.merchant?.stateCode, product.merchant?.lgaCode, product.merchant?.cityCode, product.merchant?.localityCode, product.branch?.stateCode, product.branch?.lgaCode, product.branch?.cityCode, product.branch?.localityCode].some((code) => code && validCodes.has(code)));
    }
  }
  // Post-filters
  if (area && area!=="All areas" && !area.includes("All areas")) {
    const clean = area.replace("Abuja • ","").trim();
    products = products.filter(p=> p.merchant.area?.toLowerCase() === clean.toLowerCase() || p.branch?.area?.toLowerCase() === clean.toLowerCase());
  }
  const currencyExponent = market.supportedCurrencies.find((currency) => currency.code === market.defaultCurrencyCode)?.minorUnitExponent ?? 2;
  const maxPriceMinor = maxPrice ? parseMajorAmountToMinor(String(maxPrice), currencyExponent) : null;
  const minPriceMinor = minPrice ? parseMajorAmountToMinor(String(minPrice), currencyExponent) : null;
  if ((maxPrice && maxPriceMinor === null) || (minPrice && minPriceMinor === null)) {
    return NextResponse.json({ error: `Price filters must be non-negative ${market.defaultCurrencyCode} amounts with at most ${currencyExponent} decimal places.`, code: "INVALID_PRICE_FILTER" }, { status: 400 });
  }
  if (maxPriceMinor !== null) products = products.filter((product) => BigInt(product.price) <= maxPriceMinor);
  if (minPriceMinor !== null) products = products.filter((product) => BigInt(product.price) >= minPriceMinor);
  if (openNow==="true" || openNow===true || parsed?.openNow) products = products.filter(p=> p.merchant.storeStatus==="OPEN");
  if (pickup==="true" || parsed?.pickup) products = products.filter(p=> p.pickupAvailable && p.merchant.pickupAvailable);
  if (deliveryRequested) products = products.filter(p=> p.deliveryAvailable && p.merchant.deliveryAvailable);
  if (verified==="true" || parsed?.verified) products = products.filter(p=> p.merchant.verificationStatus==="VERIFIED");
  products = products.filter((product) => !product.archived && product.merchant?.status === "APPROVED" && productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market.defaultCurrencyCode));
  const eligibleProductIds = await publicMarketplaceProductIds(products.map((product) => product.id), countryCode);
  products = products.filter((product) => eligibleProductIds.has(product.id));
  products = await withReservableAvailability(products);
  if (inStock==="true" || inStock===true || parsed?.inStock) products = products.filter((product) => product.reservableQuantity > 0);

  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const distanceFilterApplied = Boolean(distanceKm && hasCoordinates);
  const effectiveSort = sort === "nearest" && !hasCoordinates ? "relevance" : sort;
  // Distance & ranking
  let withDistance = products.map(p=>{
    let dist=null as number|null;
    if(hasCoordinates && p.merchant.lat != null && p.merchant.lng != null){
      dist = haversine(lat,lng,p.merchant.lat, p.merchant.lng);
    }
    // freshness boost: recent confirmed ranks higher for relevance
    const freshnessHrs = p.lastConfirmedAt ? (Date.now()-new Date(p.lastConfirmedAt).getTime())/3600000 : 999;
    const freshnessScore = freshnessHrs < 6 ? 0.15 : freshnessHrs < 24 ? 0.05 : 0;
    const verificationBoost = p.merchant.verificationStatus==="VERIFIED" ? 0.1 : 0;
    const score = ((p as any)._score ?? 0.5) + freshnessScore + verificationBoost;
    return { ...p, distance: dist, _rankingScore: score };
  });

  // Distance filter (within X km) if parsed
  if (distanceFilterApplied && distanceKm) {
    withDistance = withDistance.filter(p=> p.distance!==null && (p.distance as number) <= distanceKm! );
  }

  // Sorting — transparent ranking
  if (effectiveSort==="price_asc") withDistance.sort((a,b)=>a.price-b.price);
  else if (effectiveSort==="price_desc") withDistance.sort((a,b)=>b.price-a.price);
  else if (effectiveSort==="nearest" && hasCoordinates) withDistance.sort((a,b)=> (a.distance??999)-(b.distance??999));
  else if (effectiveSort==="freshness") withDistance.sort((a,b)=> new Date(b.lastConfirmedAt||b.updatedAt).getTime()-new Date(a.lastConfirmedAt||a.updatedAt).getTime());
  else if (effectiveSort==="relevance") withDistance.sort((a,b)=> (b as any)._rankingScore - (a as any)._rankingScore);
  else if (effectiveSort==="newest") withDistance.sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());

  const total = withDistance.length;
  const start = (page-1)*pageSize;
  const paged = withDistance.slice(start, start+pageSize);

  // Active promotions for this page (never invented "was" prices)
  const promos = paged.length ? await prisma.promotion.findMany({ where:{ productId:{ in: paged.map(x=>x.id) }, validFrom:{ lte: new Date() }, validUntil:{ gt: new Date() } } }) : [];
  const promoBy = new Map(promos.map(x=>[x.productId, x]));
  const variantCounts = paged.length ? await prisma.productVariant.groupBy({ by:["productId"], where:{ productId:{ in: paged.map(x=>x.id) } }, _count:true }) : [];
  const variantBy = new Map(variantCounts.map(x=>[x.productId, x._count]));

  // Generate explanations
  const results = paged.map(p=>{
    const distVal = (p as any).distance;
    return {
      id:p.id,
      name:p.name,
      brand:p.brand,
      category:p.category,
      price:p.price,
      availability:(p as any).effectiveAvailability || p.availability,
      stockQuantity:p.stockQuantity,
      reservableQuantity:(p as any).reservableQuantity ?? Math.max(0, p.stockQuantity-p.reservedQuantity),
      imageUrl:p.imageUrl,
      lastConfirmedAt:p.lastConfirmedAt,
      updatedAt:p.updatedAt,
      distance: distVal !== null ? Number(distVal.toFixed(1)) : null,
      distanceType: distVal !== null ? "STRAIGHT_LINE" : null,
      availabilityMethod: (p as any).availabilityMethod || "MERCHANT_REPORTED",
      dataSource: (p as any).dataSource || "MANUAL",
      unitType: (p as any).unitType || null,
      requiresConfirmation: !!(p as any).requiresConfirmation,
      explanation: explainResult(p, parsed, distVal),
      rankingScore: Number(((p as any)._rankingScore||0).toFixed(3)),
      promotion: promoBy.has(p.id) ? { promoPrice: promoBy.get(p.id)!.promoPrice, validUntil: promoBy.get(p.id)!.validUntil, validFrom: promoBy.get(p.id)!.validFrom } : null,
      variantCount: variantBy.get(p.id) || 0,
      branch: p.branch ? { id:p.branch.id, name:p.branch.name, area:p.branch.area, state:p.branch.state, lga:p.branch.lga, cityArea:p.branch.cityArea, storeStatus:p.branch.storeStatus } : null,
      merchant:{
        id:p.merchant.id,
        businessName:p.merchant.businessName,
        area:p.merchant.area,
        locationLabel: merchantLocationLabel(p.branch || p.merchant),
        branch: p.branch ? { id:p.branch.id, name:p.branch.name, locationLabel: merchantLocationLabel(p.branch), storeStatus:p.branch.storeStatus } : null,
        stateCode:p.merchant.stateCode,
        lgaCode:p.merchant.lgaCode,
        cityCode:p.merchant.cityCode,
        localityCode:p.merchant.localityCode,
        state:p.merchant.state ? { code:p.merchant.state.code, name:p.merchant.state.name, type:p.merchant.state.type } : null,
        lga:p.merchant.lga ? { code:p.merchant.lga.code, name:p.merchant.lga.name, type:p.merchant.lga.type } : null,
        cityArea:p.merchant.cityArea ? { code:p.merchant.cityArea.code, name:p.merchant.cityArea.name, type:p.merchant.cityArea.type } : null,
        address:p.merchant.address,
        storeStatus:p.merchant.storeStatus,
        verificationStatus:p.merchant.verificationStatus,
        phone:p.merchant.phone,
      }
    };
  });

  const currentUser = await getCurrentUser().catch(() => null);
  const related = await searchUnifiedRelated({
    query: q || rawQ,
    userId: currentUser?.id || null,
    locationFilter,
    locationScope,
    countryCode,
    limit: Math.min(pageSize, 8),
  });

  return NextResponse.json({
    query: rawQ,
    market: { countryCode: market.countryCode, countryName: market.countryName, currencyCode: market.defaultCurrencyCode, locale: market.defaultLocale },
    location: {
      countryCode: market.countryCode,
      scope: locationScope,
      selected: locationFilter.areas.map((item) => ({ code: item.code, name: item.name, type: item.type })),
      matchCodesCount: locationFilter.codes.length,
      nearbyAvailable: false,
      interpretedLocation: inferredLocation ? { code: inferredLocation.area.code, name: inferredLocation.area.name, type: inferredLocation.area.type } : null,
      notice: locationScopeNotice || null,
    },
    parsed: parsed ? {
      q: parsed.q,
      category: parsed.category,
      area: parsed.area,
      maxPrice: parsed.maxPrice,
      distanceKm: parsed.distanceKm,
      openNow: parsed.openNow,
      intent: parsed.intent,
      confidence: parsed.confidence,
      clarifications: parsed.clarifications,
    } : null,
    total,
    ...(distanceKm && !hasCoordinates ? { notice: "A radius was requested, but no valid coordinates were supplied. The distance filter was not applied; choose an area instead." } : {}),
    page,
    pageSize,
    results,
    groups: { products: results, businesses: related.businesses, services: related.services, yourLive: related.activity },
    // transparency: show how ranking was done
    ranking: {
      factors: ["query relevance","availability","freshness","distance","price","merchant verification"],
      sort: effectiveSort,
      distanceFilterApplied,
      note: "Sponsored placements are not used. Distances, when coordinates are provided, are straight-line estimates, not road distances. Without coordinates, distance filters are not applied; use an area filter. Verification never overrides reservable stock."
    }
  }, { headers: { "Cache-Control": "private, no-store" } });
}
