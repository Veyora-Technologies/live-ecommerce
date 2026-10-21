import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GeographyRequestError, getGeographicScopeFilter, type LocationScope } from "@/lib/geography";
import { publicMarketplaceCategoryWhere, publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketMerchantWhere } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let market;
  try { market = await requireOperationalMarket(params.get("countryCode") || DEFAULT_MARKET_CODE); }
  catch (cause) {
    const status = cause instanceof MarketUnavailableError ? cause.status : 503;
    const message = cause instanceof Error ? cause.message : "This market is unavailable.";
    return NextResponse.json({ error: message, code: "MARKET_UNAVAILABLE" }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const area = (params.get("area") || "").trim().slice(0, 60); // legacy exact merchant locality
  const query = (params.get("q") || "").trim().slice(0, 100);
  const locationCodes = [...params.getAll("locationCode"), ...params.getAll("locationCodes")].filter(Boolean);
  const rawScope = params.get("scope") || (locationCodes.length ? "admin" : "nationwide");
  const scopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
  if (!scopes.includes(rawScope as LocationScope)) return NextResponse.json({ error: "Choose a supported location scope" }, { status: 400 });

  try {
    const filter = await getGeographicScopeFilter(locationCodes, rawScope as LocationScope, market.countryCode);
    const marketMerchantWhere = getMarketMerchantWhere(market.countryCode);
    const merchantLocationWhere = filter.codes.length ? { OR: [filter.where, { branches: { some: filter.where } }] } : {};
    const where: any = { status: "APPROVED", AND: [marketMerchantWhere, merchantLocationWhere] };
    if (area) where.AND.push({ OR: [{ area }, { branches: { some: { area } } }] });
    if (query) where.businessName = { contains: query };
    const merchants = await prisma.merchant.findMany({
      where, take: 30, orderBy: { updatedAt: "desc" },
      select: {
        id: true, businessName: true, category: true, description: true, address: true, area: true, city: true,
        stateCode: true, lgaCode: true, cityCode: true, localityCode: true,
        state: { select: { code: true, name: true, type: true } },
        lga: { select: { code: true, name: true, type: true } },
        cityArea: { select: { code: true, name: true, type: true } },
        phone: true, whatsapp: true, imageUrl: true, coverImageUrl: true, openingHours: true, storeStatus: true,
        pickupAvailable: true, verificationStatus: true,
      },
    });
    const merchantIds=merchants.map((merchant)=>merchant.id);
    const listingRows=merchantIds.length?await prisma.marketplaceListing.findMany({
      where:{merchantId:{in:merchantIds},productId:{not:null},lifecycleStatus:"PUBLISHED",moderationStatus:"APPROVED",visibility:"PUBLIC",transactionEligible:true,category:{is:publicMarketplaceCategoryWhere()}},
      select:{merchantId:true,productId:true},
    }):[];
    const eligibleProductIds=await publicMarketplaceProductIds([...new Set(listingRows.flatMap((row)=>row.productId?[row.productId]:[]))], market.countryCode);
    const publicCountByMerchant=new Map<string,number>();
    for(const row of listingRows) if(row.merchantId&&row.productId&&eligibleProductIds.has(row.productId)) publicCountByMerchant.set(row.merchantId,(publicCountByMerchant.get(row.merchantId)||0)+1);
    const publicMerchants=merchants.map((merchant)=>({...merchant,_count:{products:publicCountByMerchant.get(merchant.id)||0}}));
    return NextResponse.json({ market: { countryCode: market.countryCode, countryName: market.countryName, currencyCode: market.defaultCurrencyCode }, merchants:publicMerchants, location: { countryCode: market.countryCode, scope: rawScope, selected: filter.areas.map((item) => ({ code: item.code, name: item.name, type: item.type })) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    throw cause;
  }
}
