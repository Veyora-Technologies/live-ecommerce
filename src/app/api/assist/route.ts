import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseNaturalQuery } from "@/lib/nlp";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { getLegalReleaseGate } from "@/lib/legal";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration, isMarketIntegrationReady } from "@/lib/market-config";
import { formatNairaMinor, MAX_PRODUCT_PRICE_MINOR, parseMajorAmountToMinor } from "@/lib/money";

type AssistAction = "search_products" | "compare_prices" | "get_reservations";

/** A small rule-based helper. It only reads the signed-in user's reservations
 * and public, approved merchant listings; it does not create reservations. */
export async function POST(req: NextRequest) {
  if (process.env.ASSIST_ENABLED === "false") return NextResponse.json({ error: "Live Assist is disabled. Use Search, Compare, or My Live instead." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const payload = await req.json().catch(() => null) as { message?: unknown } | null;
  if (!payload || typeof payload.message !== "string" || payload.message.trim().length < 1 || payload.message.length > 1000) {
    return NextResponse.json({ error: "Enter a message of 1–1000 characters." }, { status: 400 });
  }
  const message = payload.message.trim();
  const user = await getCurrentUser().catch(() => null);
  const parsed = parseNaturalQuery(message);
  if (parsed.priceFilterInvalid) return NextResponse.json({ error: "The natural-language price filter could not be read safely. Use a valid whole-Naira amount.", code: "INVALID_PRICE_FILTER" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (parsed.delivery && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations")) {
    return NextResponse.json({ error: "Delivery search is unavailable because Live has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const lower = message.toLowerCase();
  const actions: AssistAction[] = [];
  const responses: string[] = [];
  const toolResults: Array<{ tool: AssistAction; results: unknown[] }> = [];

  const isCompare = /\bcompare\b/.test(lower);
  const isTrack = /\b(track|my reservation|my order|reservation status)\b/.test(lower);
  const isReserve = /\b(reserve|book it|place an order)\b/.test(lower);
  const isSearch = /\b(find|show|search|where can|need|available|do you have)\b/.test(lower);
  if (isSearch && !isCompare && !isTrack && !isReserve) actions.push("search_products");
  if (isCompare) actions.push("compare_prices");
  if (isTrack) actions.push("get_reservations");
  if (isReserve) responses.push("Live Assist does not submit reservations. Open a product listing, check its merchant-reported availability and price, choose a quantity, then confirm on the product page. A reservation is not confirmed until Live returns a reservation code.");
  if (/\b(low stock|running low|my shop)\b/.test(lower) && !actions.length && !isReserve) {
    responses.push("Merchant inventory details are available in the Merchant console to authorized team members. Live Assist does not access your store inventory.");
  }

  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const merchantFilters: Record<string, string> = { status: "APPROVED", storeStatus: "OPEN" };
  if (parsed.area) merchantFilters.area = parsed.area;
  if (parsed.verified) merchantFilters.verificationStatus = "VERIFIED";
  const safeWhere: Record<string, unknown> = { archived: false, currency: { in: supportedCurrencies }, merchant: merchantFilters };
  if (parsed.category) safeWhere.category = parsed.category;
  if (parsed.pickup) safeWhere.pickupAvailable = true;
  if (parsed.delivery) safeWhere.deliveryAvailable = true;
  const minPriceMinor = parsed.minPrice === undefined ? null : parseMajorAmountToMinor(String(parsed.minPrice), 2);
  const maxPriceMinor = parsed.maxPrice === undefined ? null : parseMajorAmountToMinor(String(parsed.maxPrice), 2);
  if ((parsed.minPrice !== undefined && minPriceMinor === null) || (parsed.maxPrice !== undefined && maxPriceMinor === null)) {
    return NextResponse.json({ error: "The natural-language price filter could not be represented safely.", code: "INVALID_PRICE_FILTER" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (minPriceMinor !== null && minPriceMinor > BigInt(MAX_PRODUCT_PRICE_MINOR)) safeWhere.id = { in: [] };
  else if (minPriceMinor !== null) safeWhere.price = { gte: Number(minPriceMinor) };
  if (maxPriceMinor !== null && maxPriceMinor <= BigInt(MAX_PRODUCT_PRICE_MINOR)) {
    safeWhere.price = { ...(safeWhere.price as Record<string, number> || {}), lte: Number(maxPriceMinor) };
  }
  const queryText = parsed.q?.trim() || message;
  const tokens = queryText.split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}]/gu, "")).filter((token) => token.length > 2).slice(0, 8);
  const marketplaceGate = actions.some((action) => action === "search_products" || action === "compare_prices") ? await getLegalReleaseGate("MARKETPLACE") : null;

  for (const action of actions) {
    try {
      if ((action === "search_products" || action === "compare_prices") && marketplaceGate && !marketplaceGate.ready) {
        toolResults.push({ tool: action, results: [] });
        responses.push(marketplaceGate.publicMessage || "Marketplace discovery is unavailable at the moment.");
        continue;
      }
      if (action === "search_products") {
        const where = { ...safeWhere } as Record<string, unknown>;
        if (tokens.length) where.OR = tokens.map((token) => ({ name: { contains: token } }));
        const rawProducts = await prisma.product.findMany({ where: where as never, include: { merchant: true }, orderBy: { updatedAt: "desc" }, take: 100 });
        const enriched = await withReservableAvailability(rawProducts);
        const eligibleIds = await publicMarketplaceProductIds(enriched.map((product) => product.id));
        const products = enriched.filter((product) => eligibleIds.has(product.id) && product.reservableQuantity > 0 && product.merchant.status === "APPROVED" && product.merchant.storeStatus === "OPEN").slice(0, 5);
        const results = products.map((product) => ({
          name: product.name,
          price: product.price,
          availability: product.effectiveAvailability,
          merchant: product.merchant.businessName,
          area: product.merchant.area,
          storeStatus: product.merchant.storeStatus,
          lastConfirmedAt: product.lastConfirmedAt,
        }));
        toolResults.push({ tool: action, results });
        if (!products.length) responses.push(`No currently reservable, approved listings matched “${queryText}”. Try a broader term or area, or use Request an Item if available.`);
        else responses.push(`Matching Live listings (merchant-reported; check the product page before reserving): ${products.map((product) => `${product.name} at ${product.merchant.businessName}, ${product.merchant.area} — ${formatNairaMinor(product.price)} • ${product.effectiveAvailability}`).join("; ")}`);
      }
      if (action === "compare_prices") {
        const cleaned = lower.replace(/^.*?\bcompare\b/, "").replace(/\b(prices?|costs?)\b/g, " ").replace(/\b(of|for|the|across|near me)\b/g, " ").trim();
        const compareQuery = parsed.q && parsed.q.length > 1 && parsed.q !== message.toLowerCase() ? parsed.q : cleaned;
        const terms = (compareQuery || queryText).split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}]/gu, "")).filter((token) => token.length > 2).slice(0, 6);
        const where: Record<string, unknown> = { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } };
        if (terms.length) where.OR = terms.map((token) => ({ name: { contains: token } }));
        const rawProducts = await prisma.product.findMany({ where: where as never, include: { merchant: true }, orderBy: { price: "asc" }, take: 100 });
        const enriched = await withReservableAvailability(rawProducts);
        const eligibleIds = await publicMarketplaceProductIds(enriched.map((product) => product.id));
        const openListings = enriched.filter((product) => eligibleIds.has(product.id) && product.reservableQuantity > 0 && product.merchant.storeStatus === "OPEN").slice(0, 5);
        const results = openListings.map((product) => ({ name: product.name, price: product.price, merchant: product.merchant.businessName, area: product.merchant.area, availability: product.effectiveAvailability }));
        toolResults.push({ tool: action, results });
        if (!openListings.length) responses.push(`No currently reservable approved listings at merchants marked open matched “${compareQuery || queryText}”.`);
        else responses.push(`Price listings at merchants marked open, with similar names (not guaranteed to be the same brand, size, or specification): ${openListings.map((product) => `${product.name} — ${formatNairaMinor(product.price)} at ${product.merchant.businessName}, ${product.merchant.area} (${product.effectiveAvailability})`).join("; ")}`);
      }
      if (action === "get_reservations") {
        if (!user) {
          responses.push("Please sign in to view your reservations.");
        } else {
          const reservations = await prisma.reservation.findMany({ where: { consumerId: user.id }, include: { product: { select: { name: true } }, merchant: { select: { businessName: true } } }, take: 5, orderBy: { createdAt: "desc" } });
          const results = reservations.map((reservation) => ({ product: reservation.product.name, merchant: reservation.merchant.businessName, status: reservation.status, code: reservation.code, createdAt: reservation.createdAt }));
          toolResults.push({ tool: action, results });
          if (!reservations.length) responses.push("You have no reservations yet.");
          else responses.push(`Your recent reservations: ${reservations.map((reservation) => `${reservation.product.name} at ${reservation.merchant.businessName} — ${reservation.status}, code ${reservation.code}`).join("; ")}`);
        }
      }
    } catch {
      responses.push("Live Assist could not complete that request. Try Search or My Live; no reservation or other change was made.");
    }
  }

  if (parsed.distanceKm && actions.some((action) => action === "search_products")) responses.push("Distance was not applied: Live Assist has no location or road-routing access. Use a named area, such as Wuse, instead.");
  if (!responses.length) responses.push("I can search approved listings, compare similar-name listings, or show your reservations. Reservations must be submitted from a product page. Try: “Find rice in Wuse” or “Compare paracetamol prices”.");
  return NextResponse.json({
    reply: responses.join("\n\n"), parsed, toolsUsed: actions, toolResults,
    disclaimer: "Listing prices and availability are merchant-reported. Similar product names are not proof of identical specifications. Live Assist does not book, order, or contact merchants.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
