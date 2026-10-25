import Link from "next/link";
import Image from "next/image";
import { Header, BottomNav } from "@/components/Header";
import SearchLocationScope, { type SearchScope } from "@/components/SearchLocationScope";
import MarketplaceEnquiryButton from "@/components/MarketplaceEnquiryButton";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GeographyRequestError, getGeographicScopeFilter, type LocationScope } from "@/lib/geography";
import { DEFAULT_MARKET_CODE, getMarketConfiguration, getMarketCurrencyConfiguration } from "@/lib/market-config";
import { formatMinorAmount } from "@/lib/money";
import { getLegalReleaseGate } from "@/lib/legal";
import { isMarketplaceWorkflowImplemented, publicMarketplaceCategoryWhere, searchPublicMarketplaceListings } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
const scopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function priceLabel(amount: bigint | null, model: string, currencyCode: string, unit: string | null, marketCode: string) {
  if (amount === null || model === "QUOTE") return "Price on request";
  const market = getMarketConfiguration(marketCode);
  const currency = getMarketCurrencyConfiguration(marketCode, currencyCode);
  if (!market || !currency) return "Price currency is not configured for this market";
  return `${formatMinorAmount(amount, currency.code, market.defaultLocale, currency.minorUnitExponent)}${unit ? ` / ${unit.toLowerCase()}` : ""}`;
}

function availabilityLabel(state: string, confirmedAt: Date | null, isService: boolean, marketCode: string) {
  if (isService) return "Request an appointment; provider confirmation is required.";
  if (state === "AVAILABLE" && confirmedAt) {
    const market = getMarketConfiguration(marketCode);
    const timezone = market?.defaultTimezone || "UTC";
    const locale = market?.defaultLocale || "en";
    const label = new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(confirmedAt);
    return `Merchant last confirmed availability ${label} (${timezone}). This is not a guarantee.`;
  }
  if (state === "UNAVAILABLE") return "The latest inventory record shows no currently reservable quantity.";
  return "Availability is not currently confirmed. Contact the seller before travelling.";
}

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams;
  const countryCode = (first(params.countryCode) || DEFAULT_MARKET_CODE).trim().toUpperCase();
  const market = getMarketConfiguration(countryCode);
  const marketName = market?.countryName || "unavailable market";
  const query = (first(params.q) ?? "").trim().slice(0, 120);
  const categorySlug = (first(params.category) ?? "").trim();
  const rawScope = first(params.scope) || (params.locationCode ? "admin" : "nationwide");
  const scopeIsValid = scopes.includes(rawScope as LocationScope);
  const scope = scopeIsValid ? rawScope as LocationScope : "nationwide";
  const locationCodes = [params.locationCode, params.locationCodes]
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const user = await getCurrentUser().catch(() => null);
  const legalGate = await getLegalReleaseGate("MARKETPLACE");
  const categoryRows = legalGate.ready && market?.activationStatus === "ACTIVE" ? await prisma.marketplaceCategory.findMany({
    where: publicMarketplaceCategoryWhere(),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  }) : [];
  const categories = categoryRows.filter(isMarketplaceWorkflowImplemented).map(({ slug, name, listingKind, sortOrder }) => ({ slug, name, listingKind, sortOrder }));

  let locationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>> = { where: {}, areas: [], codes: [], countryCode };
  let searchError = scopeIsValid ? "" : "Choose a supported location scope. Results have not been widened automatically.";
  let listings: Awaited<ReturnType<typeof searchPublicMarketplaceListings>>["listings"] = [];
  let categoryUnavailable = false;
  try {
    if (!legalGate.ready) {
      searchError = legalGate.publicMessage ?? "Marketplace search is unavailable until Furnivo's production legal release gate is complete.";
    } else {
      if (!scopeIsValid) throw new GeographyRequestError(searchError);
      locationFilter = await getGeographicScopeFilter(locationCodes, scope, countryCode);
      const result = await searchPublicMarketplaceListings({ query, categorySlug: categorySlug || undefined, countryCode, locationFilter, limit: 60 });
      listings = result.listings;
      categoryUnavailable = result.categoryUnavailable;
      if (!result.legalGate.ready) searchError = result.legalGate.publicMessage ?? "Marketplace search is not currently available.";
    }
  } catch (cause) {
    searchError = cause instanceof GeographyRequestError ? cause.message : "Marketplace search is temporarily unavailable.";
  }

  return <div className="min-h-screen bg-slate-50">
    <Header user={user} />
    <main className="mx-auto max-w-[1200px] px-4 py-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">FURNIVO marketplace</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Find products and services</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">One search across the listing workflows Furnivo currently supports. Future categories remain hidden until their verification, transaction, and operational workflows are ready.</p>
        </div>
        <Link href={user ? "/merchant" : "/auth/login?next=/merchant"} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Seller workspace</Link>
      </div>
      {!legalGate.ready && <div role="status" className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Marketplace unavailable in production.</strong><p className="mt-1">{legalGate.publicMessage} No listing, enquiry, reservation, or appointment is being offered here. <Link href="/legal" className="font-semibold underline">View policy and release information</Link></p></div>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-900">Search and filter</h2>
          <form method="get" className="mt-4 space-y-4">
            <div>
              <label htmlFor="marketplace-q" className="text-xs font-semibold uppercase text-slate-500">What are you looking for?</label>
              <input id="marketplace-q" name="q" defaultValue={query} maxLength={120} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3" placeholder="Search products or services" />
            </div>
            <div>
              <label htmlFor="marketplace-category" className="text-xs font-semibold uppercase text-slate-500">Supported category</label>
              <select id="marketplace-category" name="category" defaultValue={categorySlug} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3">
                <option value="">All supported categories</option>
                {categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
              </select>
            </div>
            <SearchLocationScope countryCode={countryCode} initialCodes={locationCodes} initialScope={scope as SearchScope} />
            <button className="h-11 w-full rounded-full bg-live-black font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Search marketplace</button>
            <Link href={`/marketplace?countryCode=${encodeURIComponent(countryCode)}`} className="block text-center text-sm text-slate-600 underline">Clear filters</Link>
          </form>
          <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">Location scope is explicit; Furnivo does not silently replace it with GPS. Geography support is not commercial coverage.</div>
        </aside>

        <section aria-live="polite" aria-label="Marketplace search results">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold text-slate-950">{query ? `Results for “${query}”` : "Supported listings"}</h2>
                <p className="mt-1 text-xs text-slate-500">{listings.length} listing{listings.length === 1 ? "" : "s"} in this result page · {scope === "nationwide" ? `All ${marketName}` : "Selected location scope"} · sorted by latest listing review · no sponsored placements</p>
              </div>
              {locationFilter.areas.length > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{locationFilter.areas.map((area) => area.name).join(", ")}</span>}
            </div>
            {searchError && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{searchError} Results have not been widened automatically.</p>}
            {categoryUnavailable && <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This category is not enabled for public search. Categories still in setup are not shown as available commerce.</p>}
            {!searchError && !categoryUnavailable && listings.length === 0 && <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <h3 className="font-semibold text-slate-900">No matching listings in this scope</h3>
              <p className="mt-2 text-sm text-slate-600">Try a different term, category, or manually selected location. Furnivo does not invent supply or widen your search without consent.</p>
            </div>}
          </div>

          {listings.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {listings.map((listing) => {
              const isService = listing.listingKind === "SERVICE";
              const href = listing.product ? `/product/${encodeURIComponent(listing.product.id)}` : listing.service ? `/merchant/${encodeURIComponent(listing.merchant?.id || "")}#merchant-services` : "/marketplace";
              const media = listing.media[0];
              const location = listing.branch ? `${listing.branch.name} · ${listing.branch.area}, ${listing.branch.city}` : `${listing.merchant?.area || ""}${listing.merchant?.city ? `, ${listing.merchant.city}` : ""}`;
              return <article key={listing.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {media?.url ? <Image src={media.url} alt={media.altText || ""} width={800} height={500} unoptimized className="h-40 w-full object-cover" loading="lazy" /> : <div aria-hidden="true" className="flex h-32 items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">{listing.category.name}</div>}
                <div className="p-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900">{listing.category.name}</span>
                    {listing.merchant && <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white" title="Platform approval is not identity verification or a guarantee of listing claims">Platform approved</span>}
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-bold text-slate-950">{listing.title}</h3>
                  {listing.merchant && <p className="mt-1 text-sm text-slate-600">{listing.merchant.businessName}</p>}
                  {location.trim() && <p className="mt-1 text-xs text-slate-500">{location}</p>}
                  {listing.description && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{listing.description}</p>}
                  <p className="mt-3 font-semibold text-slate-950">{priceLabel(listing.priceAmountMinor, listing.priceModel, listing.currencyCode, listing.priceUnit, countryCode)}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{availabilityLabel(listing.availabilityState, listing.availabilityConfirmedAt, isService, countryCode)}</p>
                  <Link href={href} className="mt-4 inline-flex min-h-10 items-center rounded-full bg-live-black px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">{isService ? "View service and request a slot" : "View product and check reservation"}</Link>
                  {listing.merchant && <MarketplaceEnquiryButton merchantId={listing.merchant.id} {...(listing.product ? { productId: listing.product.id } : {})} {...(listing.service ? { serviceId: listing.service.id } : {})} listingTitle={listing.title} kind={isService ? "SERVICE" : "PRODUCT"} loggedIn={Boolean(user)} />}
                </div>
              </article>;
            })}
          </div>}
          <p className="mt-4 text-xs text-slate-500">Product reservations and service appointments use their own validated workflows. A listing, quote request, or appointment request is not a payment or confirmed transaction.</p>
        </section>
      </div>
    </main>
    <BottomNav pathname="/marketplace" />
  </div>;
}
