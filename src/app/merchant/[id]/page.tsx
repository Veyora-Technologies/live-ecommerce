import { prisma } from "@/lib/db";
import { Header } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import { formatNaira, timeAgo } from "@/lib/utils";
import { availabilityConfidence } from "@/lib/confidence";
import Link from "next/link";
import MerchantExtras from "./MerchantExtras";
import MerchantQrDisplay from "@/components/MerchantQrDisplay";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { merchantLocationLabel } from "@/lib/location-label";
import { publicMarketplaceProductIds, publicMarketplaceServiceIds, safeListingImageUrl } from "@/lib/marketplace";
import { getPublicBaseUrl } from "@/lib/public-url";
import { DEFAULT_MARKET_CODE, merchantBelongsToMarket } from "@/lib/market-config";
import type { Metadata } from "next";

export const dynamic="force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const merchant = await prisma.merchant.findFirst({ where: { id, status: "APPROVED" }, select: { id: true, businessName: true, description: true, imageUrl: true, countryCode: true } });
  if (!merchant || !merchantBelongsToMarket(merchant, DEFAULT_MARKET_CODE)) return { title: "Business unavailable · Live", robots: { index: false, follow: false } };
  const title = `${merchant.businessName} · Live`;
  const description = (merchant.description || `View ${merchant.businessName} on Live. Merchant-provided profile information is not independent verification.`).slice(0, 300);
  const baseUrl = getPublicBaseUrl();
  const canonical = baseUrl ? `${baseUrl}/merchant/${encodeURIComponent(id)}` : undefined;
  const image = safeListingImageUrl(merchant.imageUrl) || undefined;
  return { title, description, alternates: canonical ? { canonical } : undefined, robots: { index: true, follow: true }, openGraph: { type: "profile", title, description, ...(canonical ? { url: canonical } : {}), ...(image ? { images: [{ url: image, alt: merchant.businessName }] } : {}) } };
}

export default async function MerchantPage({ params }: { params: Promise<{id:string}>}){
  const {id}=await params;
  const user=await getCurrentUser().catch(()=>null);
  const merchant=await prisma.merchant.findUnique({ where:{id}, include:{ products:{ where:{ archived:false }, include:{ branch:{ include:{ state:true, lga:true, cityArea:true } } } }, branches:{ include:{ state:true, lga:true, cityArea:true } }, services:true, organization:true, state:true, lga:true, cityArea:true }});
  if(!merchant || (merchant.status !== "APPROVED" && merchant.ownerId !== user?.id) || (!merchantBelongsToMarket(merchant, DEFAULT_MARKET_CODE) && merchant.ownerId !== user?.id)) return <div className="p-10">Merchant not found</div>;
  const [publicProductIds, publicServiceIds] = await Promise.all([
    publicMarketplaceProductIds(merchant.products.map((product) => product.id)),
    publicMarketplaceServiceIds(merchant.services.map((service) => service.id)),
  ]);
  const visibleProductRows = merchant.products.filter((product) => publicProductIds.has(product.id));
  const visibleServices = merchant.services.filter((service) => publicServiceIds.has(service.id));
  const [merchantProducts, reviews] = await Promise.all([
    withReservableAvailability(visibleProductRows),
    prisma.review.findMany({ where:{ merchantId:id, status:"VISIBLE" }, include:{ author:{ select:{ id:true, name:true } } }, orderBy:{ createdAt:"desc" }, take:10 }),
  ]);
  const avg = reviews.length? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1): null;
  let hours:any=null; try{ hours=merchant.openingHours? JSON.parse(merchant.openingHours):null; }catch{}

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="mx-auto max-w-[1100px] px-4 py-6 pb-24">
        <div className="bg-white border border-slate-200 rounded-[24px] overflow-hidden">
          <div className="h-44 bg-slate-100 relative">
            {(merchant.coverImageUrl || merchant.imageUrl) ? <img src={merchant.coverImageUrl || merchant.imageUrl || undefined} alt="" className="w-full h-full object-cover" /> : <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-100" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute bottom-4 left-6 right-6 text-white flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black">{merchant.businessName}</h1>
                <div className="text-sm opacity-90">{merchant.category} • {merchantLocationLabel(merchant)} • {merchant.address}{merchant.organization?` • ${merchant.organization.name}`:""}</div>
              </div>
              <MerchantQrDisplay merchantId={merchant.id} businessName={merchant.businessName} className="w-20 h-20 rounded-xl bg-white p-1 hidden sm:block" />
            </div>
          </div>
          <div className="p-6 flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <p className="text-sm text-slate-600">{merchant.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${merchant.storeStatus==="OPEN"?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-red-50 text-red-700 border-red-200"}`}>{merchant.storeStatus==="OPEN"?"Merchant marked open":"Merchant marked closed"}</span>
                {merchant.verificationStatus==="VERIFIED" && <span className="text-xs bg-slate-900 text-white px-3 py-1 rounded-full">✓ Verified</span>}
                {avg && <span className="text-xs bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">{avg}★ from {reviews.length} review{reviews.length===1?"":"s"}</span>}
                <span className="text-xs bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">{merchant.pickupAvailable?"Pickup offered":""}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-semibold">Address</div><div className="text-slate-600">{merchant.address}, {merchant.area}, {merchant.city}</div></div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="font-semibold">Contact</div><div className="text-slate-600">{merchant.phone} {merchant.email?`• ${merchant.email}`:""}</div></div>
              </div>
              {merchant.branches.length>0 && (
                <div className="mt-4">
                  <h3 className="font-bold text-sm">Branches</h3>
                  <div className="mt-2 grid sm:grid-cols-2 gap-2">
                    {merchant.branches.map(b=>(
                      <div key={b.id} className="bg-slate-50 rounded-xl p-3 text-sm"><b>{b.name}</b><div className="text-slate-600">{b.address}, {merchantLocationLabel(b)} • {b.storeStatus}</div><div className="text-xs text-slate-400">Stock remains with this branch; branch-level reservations require explicit selection.</div></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="md:w-[320px] space-y-3">
              <div className="bg-slate-900 text-white rounded-2xl p-5">
                <div className="text-sm font-semibold opacity-70">Opening hours</div>
                <div className="mt-2 text-sm whitespace-pre-wrap">{hours? Object.entries(hours).map(([k,v])=>`${k}: ${v}`).join("\n") : (merchant.openingHours || "Hours not provided")}</div>
                <div className="mt-1 text-xs text-white/60">Store open/closed is separate from product stock and from whether reservations are being accepted.</div>
                <div className="mt-4 flex gap-2">
                  <a href={`tel:${merchant.phone}`} className="flex-1 h-10 grid place-items-center rounded-full bg-white text-slate-900 font-semibold text-sm">Call</a>
                  {merchant.lat != null && merchant.lng != null && <a href={`https://www.google.com/maps/search/?api=1&query=${merchant.lat},${merchant.lng}`} target="_blank" rel="noreferrer" className="flex-1 h-10 grid place-items-center rounded-full bg-live-green-ink text-white font-semibold text-sm">Map location</a>}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 items-center">
                <MerchantQrDisplay merchantId={merchant.id} businessName={merchant.businessName} className="w-24 h-24 rounded-xl border border-slate-200" />
                <div className="text-xs text-slate-600"><b className="text-slate-900 text-sm">In-store QR</b><br/>Print this at the counter. Scanning opens this verified profile, products and directions. It is never proof of payment or identity by itself.</div>
              </div>
            </div>
          </div>
        </div>

        <h2 className="mt-6 font-bold text-lg">Public marketplace listings • {merchantProducts.length} products{visibleServices.length ? ` · ${visibleServices.length} services` : ""}</h2>
        {merchantProducts.length === 0 && visibleServices.length === 0 && <p className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No listings are currently eligible for public marketplace display.</p>}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          {merchantProducts.map(p=>{
            const conf=availabilityConfidence({...p, availability:p.effectiveAvailability, stockQuantity:p.reservableQuantity, merchant});
            return (
            <Link key={p.id} href={`/product/${p.id}`} className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-sm">
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-36 w-full object-cover" loading="lazy" /> : <div aria-hidden="true" className="h-36 w-full bg-slate-100" />}
              <div className="p-3">
                <div className="text-sm font-semibold line-clamp-2 min-h-[40px]">{p.name}</div>
                <div className="font-black">{formatNaira(p.price)}</div>
                <div className="text-[11px] text-slate-500">Stock branch: {p.branch ? `${p.branch.name} · ${merchantLocationLabel(p.branch)}` : "Legacy location not recorded"}</div>
                <div className="text-xs text-slate-500">{p.reservableQuantity > 0 ? (p.effectiveAvailability === "LOW_STOCK" ? "Low stock reported" : "In stock reported") : "Not reservable"} • {p.reservableQuantity} reservable</div>
                <div className="text-[11px] text-slate-400">{conf.label} • {p.lastConfirmedAt? timeAgo(p.lastConfirmedAt):"not confirmed yet"}</div>
              </div>
            </Link>
          )})}
        </div>

        <MerchantExtras merchantId={merchant.id} services={JSON.parse(JSON.stringify(visibleServices))} reviews={JSON.parse(JSON.stringify(reviews))} loggedIn={!!user} />
      </div>
    </div>
  );
}
