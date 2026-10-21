import { prisma } from "@/lib/db";
import { Header } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";
import { DEFAULT_MARKET_CODE, getMarketConfiguration, getMarketCurrencyConfiguration } from "@/lib/market-config";
import { formatMinorAmount, minorAmountToDecimalString } from "@/lib/money";
import { Badge, AvailabilityDot } from "@/components/ui";
import { availabilityConfidence, policyForCategory } from "@/lib/confidence";
import { withReservableAvailability } from "@/lib/inventory-availability";
import RecentViewTracker from "@/components/RecentViewTracker";
import ShareButton from "@/components/ShareButton";
import PriceAlertButton from "@/components/PriceAlertButton";
import ImageWithFallback from "@/components/ImageWithFallback";
import QRCode from "qrcode";
import { headers } from "next/headers";
import Link from "next/link";
import ReserveButton from "./ReserveButton";
import ProductExtras from "./ProductExtras";
import { merchantLocationLabel } from "@/lib/location-label";
import { notFound } from "next/navigation";
import { isPublicMarketplaceProduct, publicMarketplaceProductIds, safeListingImageUrl } from "@/lib/marketplace";
import { getPublicBaseUrl } from "@/lib/public-url";
import type { Metadata } from "next";

export const dynamic="force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await prisma.product.findFirst({ where: { id, archived: false, merchant: { status: "APPROVED" } }, select: { id: true, name: true, description: true, imageUrl: true } });
  if (!product || !await isPublicMarketplaceProduct(id)) return { title: "Listing unavailable · Live", robots: { index: false, follow: false } };
  const title = `${product.name} · Live`;
  const description = (product.description || `View the seller-listed ${product.name} on Live. Availability and terms are provided by the merchant and must be confirmed.`).slice(0, 300);
  const baseUrl = getPublicBaseUrl();
  const canonical = baseUrl ? `${baseUrl}/product/${encodeURIComponent(id)}` : undefined;
  const image = safeListingImageUrl(product.imageUrl) || undefined;
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: { type: "website", title, description, ...(canonical ? { url: canonical } : {}), ...(image ? { images: [{ url: image, alt: product.name }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{id:string}>}){
  const {id} = await params;
  if (!await isPublicMarketplaceProduct(id)) notFound();
  const user = await getCurrentUser().catch(()=>null);
  const rawProduct = await prisma.product.findFirst({ where:{ id, archived:false, merchant:{ status:"APPROVED" } }, include:{ merchant:{ include:{ products:false } }, branch:true, identifiers:true }});
  if(!rawProduct) return <div className="p-10">Product not found</div>;
  const marketCode = rawProduct.branch?.countryCode || rawProduct.merchant.countryCode || DEFAULT_MARKET_CODE;
  const market = getMarketConfiguration(marketCode);
  const currencyCode = rawProduct.currency || market?.defaultCurrencyCode || "";
  const currency = market && getMarketCurrencyConfiguration(marketCode, currencyCode);
  const transactionCurrencySupported = Boolean(currency);
  const formatProductMoney = (amount: number | bigint) => market && currency
    ? formatMinorAmount(amount, currency.code, market.defaultLocale, currency.minorUnitExponent)
    : `${currencyCode || "Currency"} amount unavailable`;
  const [product] = await withReservableAvailability([rawProduct]);
  const conf = product.reservableQuantity > 0
    ? availabilityConfidence({ ...product, availability: product.effectiveAvailability, stockQuantity: product.reservableQuantity, merchant: product.merchant })
    : { label: "Not reservable" as const, tone: "grey" as const, explanation: "No unreserved, unrestricted quantity is currently available for a new reservation." };
  const shownAvailability = product.reservableQuantity <= 0 ? "UNAVAILABLE" : product.effectiveAvailability;
  const tone = shownAvailability==="IN_STOCK"?"green": shownAvailability==="LOW_STOCK"?"amber": shownAvailability==="OUT_OF_STOCK"?"red":"grey";
  const label = shownAvailability==="IN_STOCK"?"In stock": shownAvailability==="LOW_STOCK"?"Low stock": shownAvailability==="OUT_OF_STOCK"?"Out of stock": shownAvailability==="UNAVAILABLE"?"Not reservable":"Unknown";
  const availableNow = product.reservableQuantity;
  const isPharmacy = (product.category||"").toLowerCase().includes("pharmacy");

  const [exactElsewhere, priceHistory, reviews, lists] = await Promise.all([
    prisma.product.findMany({ where:{ name: product.name, id:{ not:id }, archived:false, merchant:{ status:"APPROVED" } }, include:{ merchant:true }, take:6 }),
    prisma.priceObservation.findMany({ where:{ productId:id }, orderBy:{ observedAt:"asc" }, take:30 }),
    prisma.review.findMany({ where:{ productId:id, status:"VISIBLE" }, include:{ author:{ select:{ id:true, name:true } } }, orderBy:{ createdAt:"desc" }, take:10 }),
    user ? prisma.shoppingList.findMany({ where:{ ownerId:user.id }, take:10 }) : Promise.resolve([]),
  ]);
  const publicOtherIds = await publicMarketplaceProductIds(exactElsewhere.map((item) => item.id));
  const exactElsewhereAvailable = await withReservableAvailability(exactElsewhere.filter((item) => publicOtherIds.has(item.id)));

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "";
  const safeHost = forwardedHost.split(",")[0].trim();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim();
  const requestOrigin = /^[a-zA-Z0-9.:[\]-]+$/.test(safeHost)
    ? `${forwardedProto === "https" || process.env.NODE_ENV === "production" ? "https" : "http"}://${safeHost}`
    : null;
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || requestOrigin;
  const qrDataUrl = appOrigin ? await QRCode.toDataURL(`${appOrigin}/merchant/${product.merchant.id}`, { width: 180, margin: 1 }).catch(() => null) : null;
  const publicBase = getPublicBaseUrl();
  const canonicalUrl = publicBase ? `${publicBase}/product/${encodeURIComponent(product.id)}` : undefined;
  const imageUrl = safeListingImageUrl(product.imageUrl);
  // A dynamic server render must compare stock confirmation against the request-time clock.
  // eslint-disable-next-line react-hooks/purity -- request-time freshness is intentional for server-rendered listing data.
  const confirmationAgeMs = product.lastConfirmedAt ? Date.now() - product.lastConfirmedAt.getTime() : Number.POSITIVE_INFINITY;
  const availabilityFresh = confirmationAgeMs >= 0 && confirmationAgeMs <= policyForCategory(product.category).staleAfterHours * 60 * 60 * 1000;
  const schemaOffer = availabilityFresh && Number.isSafeInteger(product.price) && product.price >= 0 && currency ? {
    "@type": "Offer",
    priceCurrency: currency.code,
    price: minorAmountToDecimalString(product.price, currency.minorUnitExponent),
    availability: availableNow > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    ...(canonicalUrl ? { url: canonicalUrl } : {}),
    seller: { "@type": "Organization", name: product.merchant.businessName },
  } : undefined;
  const structuredProduct = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    category: product.category || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    sku: product.sku || undefined,
    image: imageUrl || undefined,
    url: canonicalUrl,
    offers: schemaOffer,
  };

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredProduct).replace(/</g, "\\u003c") }} />
      <RecentViewTracker productId={product.id} enabled={!!user} />
      <div className="mx-auto max-w-[1000px] px-4 py-6 pb-24">
        <Link href="/search" className="text-sm text-slate-600">← Back to search</Link>
        <div className="mt-4 grid md:grid-cols-2 gap-6">
          <div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <ImageWithFallback src={product.imageUrl} alt={product.name} className="w-full aspect-[4/3] object-cover" />
              <div className="p-4 flex flex-wrap gap-2">
                <Badge tone={tone as any}><AvailabilityDot status={shownAvailability}/> {label}</Badge>
                <Badge tone={conf.tone as any}>{conf.label}</Badge>
                {product.barcode && <span className="text-xs bg-slate-100 border border-slate-200 rounded-full px-3 py-1">Barcode {product.barcode}</span>}
              </div>
            </div>
            <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-4">
              <h3 className="font-bold text-sm">What this availability means</h3>
              <p className="mt-1 text-sm text-slate-600">{conf.explanation}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-black text-base">{product.stockQuantity}</div>Physical stock (merchant-reported)</div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-black text-base">{product.reservedQuantity}</div>Already reserved</div>
                <div className="bg-emerald-50 rounded-xl p-3"><div className="font-black text-base">{availableNow}</div>Available to reserve</div>
              </div>
            </div>
          </div>
          <div>
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{product.category} • {product.brand}{product.sku?` • SKU ${product.sku}`:""}</div>
              <h1 className="mt-1 font-black text-2xl leading-tight">{product.name}</h1>
              <p className="mt-2 text-sm text-slate-600">{product.description}</p>
              <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                <div className="text-3xl font-black">{formatProductMoney(product.price)}</div>
                <div className="text-sm text-slate-500">per {product.unit} • merchant-listed price</div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Last confirmed {product.lastConfirmedAt ? timeAgo(product.lastConfirmedAt) : "—"} • Record updated {timeAgo(product.updatedAt)}
              </div>
              <div className="mt-5">
                {transactionCurrencySupported ? <ReserveButton productId={product.id} inStock={availableNow > 0} /> : <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Reservations and price alerts are unavailable for {currencyCode} in this market. Live has not converted this amount.</p>}
                {transactionCurrencySupported && !user && <div className="mt-2 text-xs text-slate-500">You’ll be asked to sign in to reserve. Reserving never confirms by itself — the merchant must confirm.</div>}
                {transactionCurrencySupported && <PriceAlertButton productId={product.id} loggedIn={!!user} />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-semibold">Pickup</div><div className="text-slate-600 text-xs">{product.pickupAvailable && product.merchant.pickupAvailable ? "Available — reserve, merchant confirms, then collect" : "Not available"}</div></div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-semibold">Delivery</div><div className="text-slate-600 text-xs">Live delivery integrations are not configured. Live does not verify or arrange delivery; contact the merchant directly about any seller-managed option.</div></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <Link href={`/compare?productName=${encodeURIComponent(product.name)}`} className="px-4 py-2 rounded-full bg-live-black text-white font-semibold">⚖️ Compare across stores</Link>
                <Link href={`/merchant/${product.merchant.id}`} className="px-4 py-2 rounded-full bg-white border border-slate-300 font-semibold">Visit store</Link>
                <ShareButton title={product.name} text={`See this merchant-listed product on Live: ${product.name}`} />
                {qrDataUrl && <img src={qrDataUrl} alt={`Discovery QR code for ${product.merchant.businessName}`} width="52" height="52" className="w-[52px] h-[52px] rounded-lg border border-slate-200" />}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{qrDataUrl ? "QR opens the merchant profile for discovery only — not payment or login." : "A local discovery QR is unavailable until a public application origin is configured. Use the store link instead."}</p>
            </div>

            <Link href={`/merchant/${product.merchant.id}`} className="mt-4 bg-white border border-slate-200 rounded-2xl p-4 flex gap-3">
              <ImageWithFallback src={product.merchant.imageUrl} alt={product.merchant.imageUrl ? product.merchant.businessName : ""} kind="merchant" className="w-14 h-14 rounded-xl object-cover" />
              <span className="flex-1">
                <span className="font-bold block">{product.merchant.businessName}</span>
                <span className="text-xs text-slate-500 block">{merchantLocationLabel(product.merchant)} • {product.merchant.address}</span>
                <span className="mt-1 flex gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${product.merchant.storeStatus==="OPEN"?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-red-50 text-red-700 border-red-200"}`}>{product.merchant.storeStatus==="OPEN"?"Merchant marked open":"Merchant marked closed"}</span>
                  {product.merchant.verificationStatus==="VERIFIED" && <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded-full">Verified</span>}
                </span>
              </span>
              <span className="text-live-green-ink font-semibold text-sm">View store →</span>
            </Link>

            <div className="mt-4 flex gap-2">
              <a href={`tel:${product.merchant.phone}`} className="flex-1 h-11 grid place-items-center rounded-full bg-white border border-slate-200 font-semibold text-sm">Call</a>
              {product.merchant.whatsapp && <a href={`https://wa.me/${product.merchant.whatsapp.replace(/\D/g,"")}`} target="_blank" className="flex-1 h-11 grid place-items-center rounded-full bg-[#25D366] text-white font-semibold text-sm">WhatsApp</a>}
              {product.merchant.lat != null && product.merchant.lng != null && product.merchant.locationVerifiedAt && <a href={`https://www.google.com/maps/search/?api=1&query=${product.merchant.lat},${product.merchant.lng}`} target="_blank" rel="noreferrer" className="flex-1 h-11 grid place-items-center rounded-full bg-live-black text-white font-semibold text-sm">Map location</a>}
            </div>
          </div>
        </div>

        {/* Exact product elsewhere */}
        {exactElsewhere.length>0 && (
          <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Other listings with the same product name</h3><p className="mt-1 text-xs text-slate-500">Matching names do not prove the items are identical; compare the product details and seller before deciding.</p>
            <div className="mt-3 grid md:grid-cols-3 gap-3">
              {exactElsewhereAvailable.map(p=>(
                <Link key={p.id} href={`/product/${p.id}`} className="border border-slate-200 rounded-xl p-4 block hover:shadow-sm">
                  <div className="font-semibold text-sm">{p.merchant.businessName} · {merchantLocationLabel(p.merchant)}</div>
                  <div className="font-black text-lg mt-1">{formatProductMoney(p.price)}</div>
                  <div className="text-xs text-slate-500">{p.effectiveAvailability} • {p.reservableQuantity} reservable • confirmed {p.lastConfirmedAt?timeAgo(p.lastConfirmedAt):"—"}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Price history — only real observations */}
        <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Price history</h3>
          {priceHistory.length>1 ? (
            <div className="mt-3 flex items-end gap-2 h-28" role="img" aria-label="Price history chart from recorded merchant observations only">
              {priceHistory.map((ph)=>{
                const max=Math.max(...priceHistory.map(x=>x.price));
                return <div key={ph.id} className="flex-1 flex flex-col items-center gap-1"><div className="w-full bg-live-green-ink rounded-t" style={{height:`${Math.max(12,(ph.price/max)*90)}px`}}/><span className="text-[10px] text-slate-500">{new Date(ph.observedAt).toLocaleDateString()}<br/>{formatProductMoney(ph.price)}</span></div>;
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Only the current merchant-listed price ({formatProductMoney(product.price)}) is on record. Live never invents past prices — new observations are recorded each time the merchant changes price.</p>
          )}
        </div>

        <ProductExtras productId={product.id} merchantId={product.merchant.id} reviews={JSON.parse(JSON.stringify(reviews))} lists={JSON.parse(JSON.stringify(lists))} loggedIn={!!user} isPharmacy={isPharmacy} currencySupported={transactionCurrencySupported} currencyCode={currency?.code || "NGN"} locale={market?.defaultLocale || "en-NG"} minorUnitExponent={currency?.minorUnitExponent ?? 2} />
      </div>
    </div>
  );
}
