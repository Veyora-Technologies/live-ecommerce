import { prisma } from "@/lib/db";
import { Header, BottomNav } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import { ProductCard } from "@/components/ProductCard";
import Link from "next/link";
import { cookies } from "next/headers";
import SearchLocationScope, { type SearchScope } from "@/components/SearchLocationScope";
import { GeographyRequestError, getGeographicProductWhere, getGeographicScopeFilter, resolveLocationFromText, type LocationScope } from "@/lib/geography";
import { parseNaturalQuery, expandQueryWithSynonyms } from "@/lib/nlp";
import { semanticSearch, explainResult } from "@/lib/semantic";
import { recordSearchDemand } from "@/lib/insights";
import { availabilityConfidence } from "@/lib/confidence";
import { withReservableAvailability } from "@/lib/inventory-availability";
import SaveSearchButton from "./SaveSearchButton";
import SearchTools from "./SearchTools";
import UnifiedSearchGroups from "@/components/UnifiedSearchGroups";
import { searchUnifiedRelated } from "@/lib/unified-search";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketConfiguration, getMarketCurrencyConfiguration, getMarketProductWhere, isMarketIntegrationReady, productBelongsToMarket } from "@/lib/market-config";
import { formatMinorAmount, parseMajorAmountToMinor } from "@/lib/money";

export const dynamic="force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<any>}) {
  const sp = await searchParams;
  const rawQ = (typeof sp.q === "string" ? sp.q : "").trim();
  const firstParam = (value: unknown) => Array.isArray(value) ? value[0] : value;
  const rawCountryCode = firstParam(sp.countryCode);
  const countryCode = typeof rawCountryCode === "string" && rawCountryCode.trim() ? rawCountryCode.trim().toUpperCase() : DEFAULT_MARKET_CODE;
  const market = getMarketConfiguration(countryCode);
  const marketName = market?.countryName || "unavailable market";
  const currencyCode = market?.defaultCurrencyCode || "NGN";
  const currency = getMarketCurrencyConfiguration(countryCode, currencyCode);
  const explicitCodes = [sp.locationCode, sp.locationCodes].flatMap((value: unknown) => Array.isArray(value) ? value : value ? [value] : []).filter((value: unknown): value is string => typeof value === "string" && value.length > 0);
  const explicitScope = typeof firstParam(sp.scope) === "string" ? firstParam(sp.scope) as string : "";
  const user = await getCurrentUser().catch(()=>null);
  const cookieStore = await cookies();
  const savedLocationCode = user?.preferredLocationCode || cookieStore.get("live_location_code")?.value || "";
  let locationCodes = explicitCodes.length ? explicitCodes : explicitScope ? [] : (savedLocationCode ? [savedLocationCode] : []);
  const explicitLocationSelection = Boolean(explicitScope || explicitCodes.length || savedLocationCode || sp.area);
  const requestedScope = (explicitScope || (locationCodes.length ? "admin" : "nationwide")) as string;
  const supportedScopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
  let locationScope: LocationScope = supportedScopes.includes(requestedScope as LocationScope) ? requestedScope as LocationScope : "nationwide";
  let locationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>> = { where: {}, areas: [], codes: [], countryCode };
  let locationError = "";
  let locationScopeNotice = "";
  try {
    if (!supportedScopes.includes(requestedScope as LocationScope)) throw new GeographyRequestError("Choose a supported location scope.");
locationFilter = await getGeographicScopeFilter(locationCodes, locationScope, countryCode);
  } catch (cause) {
    locationError = cause instanceof Error ? cause.message : "This location scope is unavailable.";
  }
  let area = firstParam(sp.area) || "";
  let category = firstParam(sp.category) || "";
  let maxPrice = firstParam(sp.maxPrice) || "";
  let minPrice = firstParam(sp.minPrice) || "";
  let priceError = "";
  const inStock = sp.inStock || "";
  const openNow = sp.openNow || "";
  const pickup = sp.pickup || "";
  const deliveryParam = firstParam(sp.delivery);
  const delivery = typeof deliveryParam === "string" ? deliveryParam : "";
  const verified = sp.verified || "";
  const requestedSort = sp.sort || "relevance";
  const distanceUnavailable = Boolean(parseNaturalQuery(rawQ).distanceKm) || requestedSort === "nearest";
  const sort = requestedSort === "nearest" ? "relevance" : requestedSort;

  // Natural-language intelligence and database-backed Nigerian location extraction.
  let parsed = rawQ ? parseNaturalQuery(rawQ) : null;
  let q = rawQ;
  const inferredLocation = rawQ ? await resolveLocationFromText(rawQ, countryCode).catch(() => null) : null;
  if (inferredLocation) {
    parsed = parseNaturalQuery(inferredLocation.cleanedQuery);
    q = parsed.q;
    if (!locationCodes.length && !explicitLocationSelection) {
      locationCodes = [inferredLocation.area.code];
      locationScope = "admin";
      try { locationFilter = await getGeographicScopeFilter(locationCodes, locationScope, countryCode); }
      catch (cause) { locationError = cause instanceof Error ? cause.message : "This location scope is unavailable."; }
    } else if (!locationFilter.codes.includes(inferredLocation.area.code)) {
      locationScopeNotice = `Your search phrase mentions ${inferredLocation.area.name}; results still use the explicitly selected ${locationScope} scope.`;
    }
  }
  if(parsed){
    if(!area && parsed.area) area = parsed.area;
    if(!category && parsed.category) category = parsed.category;
    if(!maxPrice && parsed.maxPrice !== undefined) maxPrice = String(parsed.maxPrice);
    if(!minPrice && parsed.minPrice !== undefined) minPrice = String(parsed.minPrice);
    if(parsed.q && parsed.q.length>1) q = parsed.q;
    await recordSearchDemand(q, category, inferredLocation?.area.name || area).catch(()=>{});
  }
  const deliveryRequested = delivery === "true" || parsed?.delivery === true;
  const deliveryIntegrationReady = isMarketIntegrationReady(countryCode, "deliveryIntegrations");
  const deliveryUnavailable = deliveryRequested && !deliveryIntegrationReady;

  const locationProductWhere = getGeographicProductWhere(locationFilter);
  const marketProductWhere = market?.activationStatus === "ACTIVE" ? getMarketProductWhere(countryCode) : { id: { in: [] as string[] } };
  const allowedCurrencies = new Set(market?.supportedCurrencies.map((item) => item.code) ?? []);
  let products:any[] = [];
  let semanticCandidatesUsed = false;
  if(q){
    const semantic = await semanticSearch(q, { category, inStock: inStock==="true"||parsed?.inStock });
    if(semantic.length) { products = semantic as any[]; semanticCandidatesUsed = true; }
    else {
      const ex = expandQueryWithSynonyms(q);
      const termWhere = { OR: ex.flatMap(t=>[ {name:{contains:t}}, {brand:{contains:t}}, {category:{contains:t}}, {merchant:{businessName:{contains:t}}} ]) };
      products = await prisma.product.findMany({
        where:{ archived:false, AND:[locationProductWhere, marketProductWhere, termWhere] },
        include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:60,
      });
    }
  } else {
    const where:any = { archived:false, AND:[locationProductWhere, marketProductWhere] };
    if(category) where.category = category;
    if(inStock==="true") where.availability = { in:["IN_STOCK","LOW_STOCK"]};
    products = await prisma.product.findMany({ where, include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:60, orderBy:{ updatedAt:"desc"}});
  }

  // Post-filters (combined correctly), with batch/reservation restrictions applied before display.
  products = products.filter((product) => !product.archived && product.merchant?.status === "APPROVED" && productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market?.defaultCurrencyCode || ""));
  if (locationError) products = [];
  else if (locationScope !== "nationwide") {
    const validCodes = new Set(locationFilter.codes);
    products = products.filter((product) => [product.merchant?.stateCode, product.merchant?.lgaCode, product.merchant?.cityCode, product.merchant?.localityCode, product.branch?.stateCode, product.branch?.lgaCode, product.branch?.cityCode, product.branch?.localityCode].some((code) => code && validCodes.has(code)));
    if (semanticCandidatesUsed && q && products.length === 0) {
      const terms = expandQueryWithSynonyms(q);
      const termWhere = { OR: terms.flatMap(t=>[ {name:{contains:t}}, {brand:{contains:t}}, {category:{contains:t}}, {merchant:{businessName:{contains:t}}} ]) };
      products = await prisma.product.findMany({ where: { archived:false, AND:[locationProductWhere, marketProductWhere, termWhere] }, include:{ merchant:{ include:{ state:true, lga:true, cityArea:true, locality:true } }, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take:60 });
      products = products.filter((product) => productBelongsToMarket(product, countryCode) && allowedCurrencies.has(product.currency || market?.defaultCurrencyCode || "") && [product.merchant?.stateCode, product.merchant?.lgaCode, product.merchant?.cityCode, product.merchant?.localityCode, product.branch?.stateCode, product.branch?.lgaCode, product.branch?.cityCode, product.branch?.localityCode].some((code) => code && validCodes.has(code)));
    }
  }
  const publicProductIds = await publicMarketplaceProductIds(products.map((product) => product.id));
  products = products.filter((product) => publicProductIds.has(product.id));
  products = await withReservableAvailability(products);
  if(inStock==="true" || parsed?.inStock) products = products.filter((product) => product.reservableQuantity > 0);
  if(area) products = products.filter(p=> p.merchant.area?.toLowerCase()===area.toLowerCase() || p.branch?.area?.toLowerCase()===area.toLowerCase());
  const priceExponent = currency?.minorUnitExponent ?? 2;
  const maxPriceMinor = maxPrice ? parseMajorAmountToMinor(String(maxPrice), priceExponent) : null;
  const minPriceMinor = minPrice ? parseMajorAmountToMinor(String(minPrice), priceExponent) : null;
  if (parsed?.priceFilterInvalid) {
    priceError = "The natural-language price filter could not be read safely. Use a valid whole-Naira amount.";
    products = [];
  } else if ((maxPrice && maxPriceMinor === null) || (minPrice && minPriceMinor === null)) {
    priceError = `Enter a non-negative ${currencyCode} price with no more than ${priceExponent} decimal places.`;
    products = [];
  } else {
    if (maxPriceMinor !== null) products = products.filter((p) => BigInt(p.price) <= maxPriceMinor);
    if (minPriceMinor !== null) products = products.filter((p) => BigInt(p.price) >= minPriceMinor);
  }
  if(openNow==="true"||parsed?.openNow) products = products.filter(p=> p.merchant.storeStatus==="OPEN");
  if(pickup==="true"||parsed?.pickup) products = products.filter(p=> p.pickupAvailable && p.merchant.pickupAvailable);
  if(deliveryRequested && deliveryIntegrationReady) products = products.filter(p=> p.deliveryAvailable && p.merchant.deliveryAvailable);
  if(verified==="true"||parsed?.verified) products = products.filter(p=> p.merchant.verificationStatus==="VERIFIED");

  // Ranking stays transparent. No current user location or road-routing integration is configured,
  // so distance filters and nearest sorting are deliberately not applied.
  const ranked = products.map(p=>{
    const hrs = p.lastConfirmedAt ? (Date.now()-new Date(p.lastConfirmedAt).getTime())/3600000 : 999;
    const score = ((p as any)._score ?? 0.5) + (hrs<6?0.15:hrs<24?0.05:0) + (p.merchant.verificationStatus==="VERIFIED"?0.1:0);
    return { ...p, distance: null, _score: score };
  });
  if(sort==="price_asc") ranked.sort((a,b)=>a.price-b.price);
  else if(sort==="price_desc") ranked.sort((a,b)=>b.price-a.price);
  else if(sort==="freshness") ranked.sort((a,b)=> new Date(b.lastConfirmedAt||b.updatedAt).getTime()-new Date(a.lastConfirmedAt||a.updatedAt).getTime());
  else ranked.sort((a,b)=> b._score - a._score);

  const lowest = ranked.length ? Math.min(...ranked.map(p=>p.price)) : null;
  const related = await searchUnifiedRelated({ query: q || rawQ, userId: user?.id || null, locationFilter, locationScope, countryCode, locationUnavailable: Boolean(locationError), limit: 6 }).catch(() => ({ businesses: [], services: [], activity: [] }));
  const hasRelated = related.businesses.length > 0 || related.services.length > 0 || related.activity.length > 0;

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="mx-auto max-w-[1200px] px-4 py-6 pb-24">
        <div className="flex flex-col lg:flex-row gap-6">
          <aside className="lg:w-[292px] shrink-0">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sticky top-[110px]">
              <h3 className="font-bold">Filters</h3>
              <form className="mt-4 space-y-4" method="get">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="q">Search in plain language</label>
                  <input id="q" name="q" defaultValue={rawQ} placeholder="Rice under ₦10,000 open now in Wuse…" className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200" />
                </div>
                <SearchTools />
                <SearchLocationScope countryCode={countryCode} initialCodes={locationCodes} initialScope={locationScope as SearchScope} />
                {area && <input type="hidden" name="area" value={area} />}
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="category">Category</label>
                  <select id="category" name="category" defaultValue={category} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200">
                    <option value="">All</option><option value="Pharmacy">Pharmacy</option><option value="Grocery">Grocery</option><option value="Essentials">Essentials</option>
                  </select>
                </div>
                <fieldset className="space-y-2 text-sm">
                  <legend className="text-xs font-semibold uppercase text-slate-500">Availability</legend>
                  <label className="flex gap-2"><input type="checkbox" name="inStock" value="true" defaultChecked={inStock==="true"}/> In stock only</label>
                  <label className="flex gap-2"><input type="checkbox" name="openNow" value="true" defaultChecked={openNow==="true"}/> Merchant marked open</label>
                  <label className="flex gap-2"><input type="checkbox" name="pickup" value="true" defaultChecked={pickup==="true"}/> Pickup available</label>
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Delivery filters are disabled while Furnivo has no configured delivery integration.</p>
                  <label className="flex gap-2"><input type="checkbox" name="verified" value="true" defaultChecked={verified==="true"}/> Verified merchants</label>
                </fieldset>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="minPrice">Min {currencyCode}</label><input id="minPrice" name="minPrice" defaultValue={minPrice} inputMode="decimal" className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200"/></div>
                  <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="maxPrice">Max {currencyCode}</label><input id="maxPrice" name="maxPrice" defaultValue={maxPrice} inputMode="decimal" className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200"/></div>
                </div>
                {priceError && <p role="alert" className="text-xs text-red-700">{priceError}</p>}
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="sort">Sort — you control ranking</label>
                  <select id="sort" name="sort" defaultValue={sort} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200">
                    <option value="relevance">Best match (relevance + freshness + trust)</option>
                    <option value="nearest" disabled>Nearest first (location not enabled)</option>
                    <option value="price_asc">Lowest price</option>
                    <option value="price_desc">Highest price</option>
                    <option value="freshness">Most recently confirmed</option>
                  </select>
                </div>
                <button className="w-full h-10 rounded-full bg-live-black text-white font-semibold">Apply</button>
                <Link href={`/search?countryCode=${encodeURIComponent(countryCode)}`} className="block text-center text-sm text-slate-600">Clear all</Link>
              </form>
              {user && rawQ && <SaveSearchButton query={rawQ} filters={{ countryCode, area, locationCode: locationCodes[0] || "", locationCodes: locationCodes.slice(1), scope: locationScope, category, minPrice, maxPrice, sort, inStock: inStock === "true", openNow: openNow === "true", pickup: pickup === "true", verified: verified === "true" }} alertsSupported={!parsed?.distanceKm && !deliveryUnavailable} />}
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <h1 className="font-black text-xl">{rawQ? `“${rawQ}”` : "Browse merchant listings"} <span className="text-slate-500 font-normal text-sm">• {ranked.length} product listings</span></h1>
            <p className="mt-2 text-sm"><Link href={`/marketplace?countryCode=${encodeURIComponent(countryCode)}${rawQ ? `&q=${encodeURIComponent(rawQ)}` : ""}`} className="font-semibold text-emerald-800 underline">Browse all currently supported marketplace listings</Link></p>
            <p className="mt-1 text-xs text-slate-500">Scope: {locationScope === "nationwide" ? `All ${marketName}` : locationScope === "multi" ? "Selected locations" : locationScope === "locality" ? "Exact selected locality" : "Selected area and contained locations"}{locationFilter.areas.length > 0 ? ` · ${locationFilter.areas.map((item) => item.name).join(", ")}` : ""}. Geography support is not a claim of merchant coverage. {locationFilter.areas.length === 1 && <Link className="font-semibold text-emerald-800 underline" href={`/location/${encodeURIComponent(locationFilter.areas[0].code)}`}>Open this location page</Link>}</p>
            {locationError && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{locationError} Results have not been widened automatically.</p>}
            {locationScopeNotice && <p className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900" role="status">{locationScopeNotice}</p>}
            {parsed && (
              <div className="mt-2 bg-live-black text-white rounded-2xl p-4 text-sm">
                <span className="font-bold">Understood as:</span> product “{parsed.q}”
                {parsed.category && <> • category {parsed.category}</>}
                {parsed.area && <> • legacy merchant area {parsed.area}</>}
                {parsed.maxPrice !== undefined && <> • under ₦{parsed.maxPrice.toLocaleString()}</>}
                {parsed.distanceKm && <> • requested radius {parsed.distanceKm} km</>}
                {parsed.openNow && <> • merchant marked open</>}
                <span className="block mt-1 text-white/60 text-xs">Confidence {Math.round(parsed.confidence*100)}%. Inferred filters are shown explicitly — edit them on the left to correct anything. Confirmed facts come only from merchant records.</span>
                {parsed.clarifications?.filter(Boolean).map(c=>(<span key={c} className="block mt-1 text-amber-300 text-xs">ℹ {c}</span>))}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">Ranking uses relevance, freshness, verification and the sort you select. No sponsored results. Availability uses confidence labels — never a guarantee. No GPS or road-routing service is configured; manual area selection works without location access.</p>
            {distanceUnavailable && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">A distance filter or nearest sort was requested, but Furnivo is not using a current location or road-routing service. That distance request was not applied; choose an area filter instead.</p>}
            {deliveryUnavailable && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">A delivery filter was requested, but Furnivo has no configured delivery integration. That request was not applied; Furnivo does not verify or arrange delivery.</p>}

            {(ranked.length > 0 || hasRelated) && <UnifiedSearchGroups productCount={ranked.length} businesses={related.businesses} services={related.services} activity={related.activity} signedIn={Boolean(user)} />}
            {ranked.length===0 && !hasRelated ? (
              <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-10 text-center">
                <div className="text-4xl">🔍</div>
                <div className="mt-3 font-bold">No matches yet</div>
                <div className="text-sm text-slate-500">Try fewer filters, change or widen the selected location scope, use a common synonym, or request an item. Nearby merchants can respond only if they have a real Furnivo listing.</div>
                <div className="mt-4 flex gap-2 justify-center">
                  <Link href="/search" className="px-5 py-2 rounded-full bg-white border border-slate-300 text-sm font-semibold">Clear filters</Link>
                  <Link href="/requests" className="px-5 py-2 rounded-full bg-live-green-ink text-white text-sm font-semibold">Request an item</Link>
                </div>
              </div>
            ) : ranked.length===0 ? (
              <div id="unified-products" className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No product listings match these filters. Other matching types are shown above.</div>
            ) : (
              <section id="unified-products" aria-label="Product listings">
                {lowest!==null && <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="bg-white border border-slate-200 rounded-full px-3 py-1.5">Lowest listed price in these results: <b>{formatMinorAmount(lowest, currencyCode, market?.defaultLocale || "en-NG", currency?.minorUnitExponent ?? 2)}</b></span></div>}
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {ranked.map(p=>{
                    const conf = availabilityConfidence({ ...p, availability: p.effectiveAvailability, stockQuantity: p.reservableQuantity });
                    const expl = [explainResult(p, parsed, p.distance??undefined), `${conf.label}`].filter(Boolean).join(" • ");
                    return <ProductCard key={p.id} p={p} explanation={expl} />;
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      <BottomNav pathname="/search" />
    </div>
  );
}
