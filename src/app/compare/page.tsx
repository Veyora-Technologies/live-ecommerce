import { Header } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import { compareProducts } from "@/lib/compare-products";
import { formatNaira } from "@/lib/utils";
import Link from "next/link";

export const dynamic="force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<any>}) {
  const sp=await searchParams;
  const q=String(sp.productName || sp.q || "Paracetamol").slice(0,120);
  const area=typeof sp.area === "string" ? sp.area : "";
  const user=await getCurrentUser().catch(()=>null);
  const data=await compareProducts({ productName:q, area });

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <h1 className="font-black text-2xl">Compare listings — {q}</h1>
        <p className="mt-1 text-sm text-slate-600">Compare merchant-listed prices. Similar names may refer to different brands, sizes, or specifications; check each listing before deciding.</p>

        <form className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="productName" className="sr-only">Product name to compare</label>
          <input id="productName" name="productName" defaultValue={q} className="min-w-0 flex-1 h-11 px-4 rounded-full border border-slate-300" placeholder="Product name" />
          <label htmlFor="area" className="sr-only">Area filter</label>
          <input id="area" name="area" defaultValue={area} className="w-full sm:w-48 h-11 px-4 rounded-full border border-slate-300" placeholder="Area (optional)" />
          <button className="h-11 px-6 rounded-full bg-live-black text-white font-semibold">Compare</button>
          <Link href="/search" className="h-11 px-6 rounded-full bg-white border border-slate-300 grid place-items-center text-sm font-semibold">Search</Link>
        </form>

        {data.note && <p className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">{data.note}</p>}
        {data.code === "LEGAL_RELEASE_GATE" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{data.error}</p>}
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.products?.map((p:any,i:number)=>(
            <article key={p.id || i} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">{p.merchant.area} · Merchant marked {p.merchant.storeStatus?.toLowerCase()}</div>
              <h2 className="mt-1 font-bold">{p.merchant.businessName} {p.merchant.verificationStatus==="VERIFIED" && <span className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-2 py-0.5">Merchant verified</span>}</h2>
              <div className="mt-3 font-black text-2xl">{formatNaira(p.price)}</div>
              <div className="text-xs text-slate-600">Merchant-listed price{p.quantity ? ` per ${p.quantity}` : ""} · not a checkout total</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`px-2 py-1 rounded-full border font-semibold ${p.availability==="IN_STOCK"?"bg-emerald-50 text-emerald-800 border-emerald-200": p.availability==="LOW_STOCK"?"bg-amber-50 text-amber-900 border-amber-200":"bg-slate-100 text-slate-700 border-slate-300"}`}>{p.availability?.replaceAll("_", " ") || "Availability not reported"}</span>
                {p.distance !== null && p.distance !== undefined && <span className="bg-slate-100 border border-slate-300 px-2 py-1 rounded-full">{p.distance} km straight-line</span>}
                {p.pickupAvailable && <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-full">Pickup offered</span>}
              </div>
              <div className="mt-3 text-xs text-slate-600">Last merchant confirmation: {p.lastConfirmedAt? new Date(p.lastConfirmedAt).toLocaleString(): "none recorded"}</div>
              <Link href={p.id ? `/product/${encodeURIComponent(p.id)}` : `/search?q=${encodeURIComponent(p.name)}`} className="mt-4 block min-h-11 rounded-full bg-slate-900 text-white grid place-items-center text-sm font-semibold">View listing</Link>
            </article>
          ))}
          {data.code !== "LEGAL_RELEASE_GATE" && (!data.products||data.products.length===0) && <div className="text-sm text-slate-600">No public listing matched this name. Try fewer terms or a different area.</div>}
        </div>

        {data.priceHistory?.length > 0 && (
          <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="font-bold">Observed price records for the first listing</h2>
            <p className="text-xs text-slate-600">These are records for one listing, not a market-wide trend or forecast. If there is only one observation, there is not enough history to compare.</p>
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {data.priceHistory.map((ph:any,i:number)=>(
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center min-w-[120px]">
                  <div className="font-bold">{formatNaira(ph.price)}</div>
                  <div className="text-xs text-slate-600">{new Date(ph.observedAt).toLocaleDateString()}</div>
                  <div className="text-xs text-slate-500">{ph.source}</div>
                </div>
              ))}
              {data.priceHistory.length<=1 && <div className="text-xs text-slate-600 self-center">Not enough recorded history for a comparison.</div>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
