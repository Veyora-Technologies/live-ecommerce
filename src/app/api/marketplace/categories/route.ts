import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLegalReleaseGate } from "@/lib/legal";
import { isMarketplaceWorkflowImplemented, publicMarketplaceCategoryWhere } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";
import { CACHE_POLICIES, publicCache } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let market;
  try { market = await requireOperationalMarket(request.nextUrl.searchParams.get("countryCode") || DEFAULT_MARKET_CODE); }
  catch (cause) {
    const status = cause instanceof MarketUnavailableError ? cause.status : 503;
    const message = cause instanceof Error ? cause.message : "This market is unavailable.";
    return NextResponse.json({ categories: [], error: message, code: "MARKET_UNAVAILABLE" }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const gate = await getLegalReleaseGate("MARKETPLACE");
  if (!gate.ready) return NextResponse.json({ market: { countryCode: market.countryCode, countryName: market.countryName }, categories: [], marketplaceUnavailable: true, notice: gate.publicMessage }, { headers: { "Cache-Control": "no-store" } });
  const rows = await prisma.marketplaceCategory.findMany({
    where: publicMarketplaceCategoryWhere(),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const categories = rows.filter(isMarketplaceWorkflowImplemented).map(({ slug, name, description, listingKind, requiresReview, requiresSellerVerification, schemaVersion, sortOrder }) => ({
    slug, name, description, listingKind, requiresReview, requiresSellerVerification, schemaVersion, sortOrder,
  }));
  // Reference data, but only shared-cacheable when the caller is anonymous:
  // `publicCache` degrades to no-store if the request carried a session cookie.
  return NextResponse.json({ market: { countryCode: market.countryCode, countryName: market.countryName }, categories }, {
    headers: publicCache(CACHE_POLICIES.marketplaceReference, request),
  });
}
