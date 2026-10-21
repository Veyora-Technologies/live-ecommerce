import { NextRequest, NextResponse } from "next/server";
import { getLivePulseUpdates } from "@/lib/pulse";
import { GeographyRequestError, type LocationScope } from "@/lib/geography";
import { DEFAULT_MARKET_CODE, getMarketConfiguration } from "@/lib/market-config";

export const dynamic = "force-dynamic";

/** Polled availability changes from real merchant events; no simulated activity. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const countryCode = (params.get("countryCode") || DEFAULT_MARKET_CODE).trim().toUpperCase();
  const market = getMarketConfiguration(countryCode);
  const locationCodes = [...params.getAll("locationCode"), ...params.getAll("locationCodes")].filter(Boolean);
  const rawScope = params.get("scope") || (locationCodes.length ? "admin" : "nationwide");
  const scopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
  if (!scopes.includes(rawScope as LocationScope)) return NextResponse.json({ error: "Choose a supported location scope" }, { status: 400 });
  const legacyArea = (params.get("area") || "").trim().slice(0, 60);
  try {
    const updates = await getLivePulseUpdates(locationCodes, rawScope as LocationScope, legacyArea || null, countryCode);
    return NextResponse.json({
      asOf: new Date().toISOString(), pollSeconds: 60, scope: rawScope,
      market: market ? { countryCode: market.countryCode, countryName: market.countryName } : { countryCode },
      selectedCodes: locationCodes, legacyArea: legacyArea || null, updates,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (cause) {
    if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    throw cause;
  }
}
