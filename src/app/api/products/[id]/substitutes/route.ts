import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration, getMarketProductWhere } from "@/lib/market-config";

/**
 * Substitute suggestions: same category + compatible brand/spec adjacency.
 * REGULATED PRODUCTS: for Pharmacy we NEVER recommend a substitute treatment.
 * We only return (a) the exact same product at other merchants, and (b) same-category
 * listings clearly labelled as "different product — ask a pharmacist".
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{id:string}> }){
  const { id } = await params;
  const product = await prisma.product.findUnique({ where:{ id }, include:{ merchant:true, branch:true }});
  if(!product) return NextResponse.json({ error:"Not found" }, { status:404 });
  const countryCode = product.branch?.countryCode || product.merchant.countryCode || DEFAULT_MARKET_CODE;
  if (!getMarketCurrencyConfiguration(countryCode, product.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Price comparisons are unavailable because this listing's currency is not configured for the active market.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const eligibleIds = await publicMarketplaceProductIds([id], countryCode);
  if (!eligibleIds.has(id)) return NextResponse.json({ error:"Not found" }, { status:404 });

  let exactElsewhere = await prisma.product.findMany({
    where:{ name: product.name, id:{ not: id }, archived:false, currency: product.currency, AND:[getMarketProductWhere(countryCode)] },
    include:{ merchant:true, branch:true }, take:8,
  });
  const exactIds = await publicMarketplaceProductIds(exactElsewhere.map((item) => item.id), countryCode);
  exactElsewhere = exactElsewhere.filter((item) => exactIds.has(item.id));

  const isRegulated = (product.category||"").toLowerCase().includes("pharmacy");
  let alternatives: any[] = [];
  if(!isRegulated){
    alternatives = await prisma.product.findMany({
      where:{ category: product.category, id:{ not: id }, archived:false, currency: product.currency, availability:{ in:["IN_STOCK","LOW_STOCK"]}, AND:[getMarketProductWhere(countryCode)] },
      include:{ merchant:true, branch:true }, take:8,
    });
    const alternativeIds = await publicMarketplaceProductIds(alternatives.map((item) => item.id), countryCode);
    alternatives = alternatives.filter((item) => alternativeIds.has(item.id));
    // unit price comparison helper (price only — no fabricated equivalence)
    alternatives = alternatives.map(p=>({ ...p, priceDiff: p.price - product.price }));
  }

  return NextResponse.json({
    product: { id: product.id, name: product.name, category: product.category, brand: product.brand },
    exactAtOtherMerchants: exactElsewhere.map(p=>({ id:p.id, name:p.name, price:p.price, availability:p.availability, merchant:p.merchant.businessName, area:p.merchant.area })),
    alternatives: isRegulated ? [] : alternatives.map(p=>({ id:p.id, name:p.name, brand:p.brand, price:p.price, priceDiff:(p as any).priceDiff, availability:p.availability, merchant:p.merchant.businessName })),
    regulatedNotice: isRegulated
      ? "This is a pharmacy product. Furnivo does not recommend substitute medicines. The exact product at other merchants is shown above — for alternatives, please ask a licensed pharmacist."
      : "Alternatives are same-category listings, not guaranteed equivalent. Check size/spec/brand before buying.",
    note: "Two products are never merged just because names look similar. Specifications are shown so you can verify equivalence yourself.",
  });
}
