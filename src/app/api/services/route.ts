import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageTeam, merchantRole } from "@/lib/permissions";
import { GeographyRequestError, getGeographicScopeFilter, type LocationScope } from "@/lib/geography";
import { publicMarketplaceCategoryWhere, publicMarketplaceServiceIds, syncServiceMarketplaceListing } from "@/lib/marketplace";
import { getLegalReleaseGate } from "@/lib/legal";
import { DEFAULT_MARKET_CODE, getMarketMerchantWhere } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";
import { parseMajorAmountToMinor } from "@/lib/money";

export const dynamic = "force-dynamic";

const serviceSchema = z.object({
  merchantId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  // Client-facing price is in NGN; parse decimal text directly to integer kobo below.
  price: z.preprocess((value) => value === "" || value === null || value === undefined ? undefined : typeof value === "number" ? value.toString() : value,
    z.string().regex(/^\d+(?:\.\d{1,2})?$/).refine((value) => {
      const minor = parseMajorAmountToMinor(value, 2);
      return minor !== null && minor <= 1_000_000_000n;
    }, "Enter a price of no more than 10,000,000 NGN with at most two decimal places").optional()),
  durationMin: z.preprocess((value) => value === "" || value === null || value === undefined ? undefined : typeof value === "string" ? Number(value) : value,
    z.number().int().min(5).max(1440).optional()),
  capacity: z.preprocess((value) => value === "" || value === null || value === undefined ? 1 : typeof value === "string" ? Number(value) : value,
    z.number().int().min(1).max(100).default(1)),
}).strict();

const publicMerchantSelect = {
  id: true, businessName: true, category: true, area: true, city: true,
  stateCode: true, lgaCode: true, cityCode: true, localityCode: true,
  storeStatus: true, verificationStatus: true,
  state: { select: { code: true, name: true, type: true } },
  lga: { select: { code: true, name: true, type: true } },
  cityArea: { select: { code: true, name: true, type: true } },
} as const;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const countryCode = params.get("countryCode") || DEFAULT_MARKET_CODE;
  let market;
  try { market = await requireOperationalMarket(countryCode); }
  catch (cause) {
    const status = cause instanceof MarketUnavailableError ? cause.status : 503;
    const message = cause instanceof Error ? cause.message : "This market is unavailable.";
    return NextResponse.json({ error: message, code: "MARKET_UNAVAILABLE" }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const marketMerchantWhere = getMarketMerchantWhere(market.countryCode);
  const merchantId = (params.get("merchantId") || "").trim();
  const query = (params.get("q") || "").trim().slice(0, 120);
  const user = await getCurrentUser().catch(() => null);
  const role = user && merchantId ? await merchantRole(merchantId, user.id) : null;
  const mayViewUnapproved = Boolean(role);
  if (!mayViewUnapproved) {
    const gate = await getLegalReleaseGate("MARKETPLACE");
    if (!gate.ready) return NextResponse.json({ services: [], error: gate.publicMessage, code: "LEGAL_RELEASE_GATE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const rawScope = params.get("scope") || (params.getAll("locationCode").length ? "admin" : "nationwide");
  const scopes: LocationScope[] = ["nationwide", "admin", "locality", "multi", "nearby"];
  if (!scopes.includes(rawScope as LocationScope)) return NextResponse.json({ error: "Choose a supported location scope" }, { status: 400 });
  try {
    const locationCodes = [...params.getAll("locationCode"), ...params.getAll("locationCodes")].filter(Boolean);
    const locationFilter = await getGeographicScopeFilter(locationCodes, rawScope as LocationScope, market.countryCode);
    const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 1).slice(0, 6);
    const where: any = merchantId && mayViewUnapproved
      ? { merchantId }
      : { merchant: { status: "APPROVED", AND: [marketMerchantWhere, ...(locationFilter.codes.length ? [locationFilter.where] : [])] }, marketplaceListing: { is: { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, category: { is: publicMarketplaceCategoryWhere() } } } };
    if (merchantId && !mayViewUnapproved) where.merchantId = merchantId;
    if (tokens.length) where.OR = tokens.flatMap((token) => [{ name: { contains: token } }, { description: { contains: token } }]);

    let services = await prisma.service.findMany({
      where,
      select: { id: true, name: true, description: true, price: true, durationMin: true, capacity: true, createdAt: true, updatedAt: true, merchant: { select: publicMerchantSelect } },
      orderBy: { updatedAt: "desc" }, take: 50,
    });
    if (!mayViewUnapproved) {
      const publicIds = await publicMarketplaceServiceIds(services.map((service) => service.id), market.countryCode);
      services = services.filter((service) => publicIds.has(service.id));
    }
    return NextResponse.json({ market: { countryCode: market.countryCode, countryName: market.countryName, currencyCode: market.defaultCurrencyCode }, services, location: { countryCode: market.countryCode, scope: rawScope, selected: locationFilter.areas.map(({ code, name, type }) => ({ code, name, type })) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof GeographyRequestError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    throw cause;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = serviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid service details" }, { status: 400 });
  const input = parsed.data;
  const role = await merchantRole(input.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Only an owner or manager can publish services" }, { status: 403 });
  const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true } });
  if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  const priceMinor = input.price === undefined ? null : parseMajorAmountToMinor(input.price, 2);
  if (input.price !== undefined && (priceMinor === null || priceMinor > 2_147_483_647n)) {
    return NextResponse.json({ error: "Enter a price with no more than two decimal places within the current service price limit" }, { status: 400 });
  }
  const price = priceMinor === null ? null : Number(priceMinor);
  try {
    const service = await prisma.$transaction(async (tx) => {
      const created = await tx.service.create({ data: { merchantId: merchant.id, name: input.name, description: input.description || null, price, durationMin: input.durationMin ?? null, capacity: input.capacity } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "SERVICE_CREATE", resourceType: "Service", resourceId: created.id, outcome: "SUCCESS" } });
      await syncServiceMarketplaceListing(tx, created.id, user.id);
      return created;
    });
    return NextResponse.json({ service }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Service could not be published. Please try again." }, { status: 400 });
  }
}
