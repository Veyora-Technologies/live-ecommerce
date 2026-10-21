import { NextRequest, NextResponse } from "next/server";
import { GeographyRequestError, getGeographicScopeFilter, type LocationScope } from "@/lib/geography";
import { marketplaceListingJson, searchPublicMarketplaceListings } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

export const dynamic = "force-dynamic";

const LOCATION_SCOPES: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  const categorySlug = (params.get("category") ?? "").trim();
  const countryCode = params.get("countryCode") || DEFAULT_MARKET_CODE;
  if (query.length > 120) return NextResponse.json({ error: "Search text must be 120 characters or fewer." }, { status: 400 });
  if (categorySlug.length > 80) return NextResponse.json({ error: "Category is invalid." }, { status: 400 });

  const rawScope = params.get("scope") || (params.getAll("locationCode").length ? "admin" : "nationwide");
  if (!LOCATION_SCOPES.includes(rawScope as LocationScope)) return NextResponse.json({ error: "Choose a supported location scope." }, { status: 400 });

  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) return NextResponse.json({ error: "Limit must be a whole number from 1 to 60." }, { status: 400 });

  try {
    const market = await requireOperationalMarket(countryCode);
    const locationCodes = [...params.getAll("locationCode"), ...params.getAll("locationCodes")].filter(Boolean);
    const locationFilter = await getGeographicScopeFilter(locationCodes, rawScope as LocationScope, market.countryCode);
    const result = await searchPublicMarketplaceListings({ query, categorySlug: categorySlug || undefined, countryCode: market.countryCode, locationFilter, limit });
    if (!result.legalGate.ready) return NextResponse.json({ error: result.legalGate.publicMessage, code: "LEGAL_RELEASE_GATE", policyUrl: "/legal" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (result.categoryUnavailable) return NextResponse.json({ error: "That marketplace category is not enabled for public search." }, { status: 404 });
    return NextResponse.json({
      listings: result.listings.map(marketplaceListingJson),
      market: { countryCode: market.countryCode, countryName: market.countryName, currencyCode: market.defaultCurrencyCode, locale: market.defaultLocale },
      location: {
        countryCode: market.countryCode,
        scope: rawScope,
        selected: locationFilter.areas.map(({ code, name, type }) => ({ code, name, type })),
      },
      note: "Only code-enabled, published listings are shown. Availability and transaction terms are revalidated by their product or service workflow.",
    }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } });
  } catch (cause) {
    if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    if (cause instanceof MarketUnavailableError) return NextResponse.json({ error: cause.message, code: "MARKET_UNAVAILABLE" }, { status: cause.status, headers: { "Cache-Control": "no-store" } });
    throw cause;
  }
}
