import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findGeographicArea, geographicPath, normalizeGeographyText } from "@/lib/geography";
import { DEFAULT_MARKET_CODE } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

export const dynamic = "force-dynamic";

function toOption(area: any) {
  return {
    code: area.code,
    name: area.name,
    type: area.type,
    parentCode: area.parentCode ?? null,
    countryCode: area.countryCode,
    adminLevel: area.adminLevel,
    path: geographicPath(area),
  };
}

/** Public, non-sensitive geography lookup for a server-enabled market. No merchant coverage is implied. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let market;
  try {
    market = await requireOperationalMarket(params.get("countryCode") || DEFAULT_MARKET_CODE);
  } catch (cause) {
    const status = cause instanceof MarketUnavailableError ? cause.status : 503;
    const message = cause instanceof Error ? cause.message : "This market is unavailable.";
    return NextResponse.json({ error: message, code: "MARKET_UNAVAILABLE" }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const countryCode = market.countryCode;
  const rawCode = (params.get("code") || "").trim();
  const rawQuery = (params.get("q") || "").trim();
  const parentCode = (params.get("parentCode") || "").trim();
  const limitValue = Number(params.get("limit") || 40);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(50, Math.floor(limitValue))) : 40;

  if (rawCode) {
    if (rawCode.length > 64) return NextResponse.json({ error: "Invalid location code" }, { status: 400 });
    const area = await findGeographicArea(rawCode, countryCode);
    if (!area) return NextResponse.json({ error: "Location not found in this market" }, { status: 404 });
    return NextResponse.json({ location: toOption(area), countryCode }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  }

  if (parentCode) {
    if (parentCode.length > 64) return NextResponse.json({ error: "Invalid parent location code" }, { status: 400 });
    const parent = await prisma.geographicArea.findFirst({ where: { code: parentCode, countryCode, active: true }, select: { code: true } });
    if (!parent) return NextResponse.json({ error: "Parent location not found in this market" }, { status: 404 });
    const children = await prisma.geographicArea.findMany({
      where: { parentCode, countryCode, active: true },
      include: { parent: { include: { parent: true } } },
      orderBy: { name: "asc" }, take: limit,
    });
    return NextResponse.json({ locations: children.map(toOption), countryCode }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  }

  const query = normalizeGeographyText(rawQuery);
  if (rawQuery.length > 100) return NextResponse.json({ error: "Search text is too long" }, { status: 400 });
  if (!query || query.length < 2) {
    const topLevel = await prisma.geographicArea.findMany({
      where: {
        countryCode,
        active: true,
        parentCode: market.geography.rootCode,
        type: { in: [...market.geography.topLevelTypes] },
      },
      include: { parent: { include: { parent: true } } },
      orderBy: { name: "asc" }, take: 50,
    });
    return NextResponse.json({ locations: topLevel.map(toOption), countryCode }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  }

  const matches = await prisma.geographicArea.findMany({
    where: {
      countryCode,
      active: true,
      OR: [
        { normalizedName: { contains: query } },
        { aliases: { some: { normalizedAlias: { contains: query } } } },
      ],
    },
    include: {
      parent: { include: { parent: true } },
      aliases: { where: { normalizedAlias: { contains: query } }, select: { normalizedAlias: true }, take: 8 },
    },
    take: 100,
  });

  const ranked = matches.map((area: any) => {
    const exact = area.normalizedName === query || area.aliases.some((item: any) => item.normalizedAlias === query);
    const prefix = area.normalizedName.startsWith(query) || area.aliases.some((item: any) => item.normalizedAlias.startsWith(query));
    const score = exact ? 0 : prefix ? 1 : 2;
    return { area, score };
  }).sort((a, b) => a.score - b.score || a.area.adminLevel - b.area.adminLevel || a.area.name.localeCompare(b.area.name)).slice(0, limit);

  return NextResponse.json({ locations: ranked.map(({ area }) => toOption(area)), query: rawQuery, countryCode }, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
