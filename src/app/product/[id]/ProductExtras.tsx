"use client";
import { useEffect, useState } from "react";
import { formatMinorAmount } from "@/lib/money";

export default function ProductExtras({ productId, merchantId, reviews, lists, loggedIn, isPharmacy, currencySupported = true, currencyCode = "NGN", locale = "en-NG", minorUnitExponent = 2 }: any){
  const [subs,setSubs]=useState<any>(null);
  const [listId,setListId]=useState(lists[0]?.id||"");
  const [rating,setRating]=useState(5);
  const [text,setText]=useState("");
  const [msg,setMsg]=useState("");
  const [allReviews,setReviews]=useState(reviews||[]);

  useEffect(()=>{ fetch(`/api/products/${productId}/substitutes`).then(r=>r.json()).then(setSubs).catch(()=>{}); },[productId]);

  const addToList=async()=>{
    if(!currencySupported){ setMsg("This listing's currency is not supported for money features in the active market."); return; }
    if(!listId){ setMsg("Create a list first (Lists in the menu)."); return; }
    const res=await fetch(`/api/lists/${listId}`,{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ productId, quantity:1 })});
    setMsg(res.ok? "Added to list ✓":"Could not add to list");
  };
  const submitReview=async(e:any)=>{
    e.preventDefault();
    const res=await fetch("/api/reviews",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ merchantId, productId, rating, text })});
    const data=await res.json();
    if(res.ok){ setReviews([data.review, ...allReviews]); setText(""); setMsg(data.review.verifiedPurchase? "Review posted (verified purchase)":"Review posted"); }
    else setMsg(data.error||"Could not post review");
  };

  return (
    <div className="mt-6 grid md:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Alternatives</h3>
        {!currencySupported ? (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">Price comparisons are unavailable because this currency is not configured for the active market. Furnivo does not convert listing amounts.</div>
        ) : isPharmacy ? (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
            Furnivo does not recommend substitute medicines. Exact matches at other stores are shown above. For any alternative, please ask the licensed pharmacist.
          </div>
        ) : subs?.alternatives?.length ? (
          <div className="mt-3 space-y-2">
            {subs.alternatives.map((a:any)=>(
              <a key={a.id} href={`/product/${a.id}`} className="block bg-slate-50 rounded-xl p-3 text-sm">
                <span className="font-semibold">{a.name}</span> — {formatMinorAmount(a.price, currencyCode, locale, minorUnitExponent)}
                <span className="block text-xs text-slate-500">{a.merchant} • {a.priceDiff<0? `${formatMinorAmount(-a.priceDiff, currencyCode, locale, minorUnitExponent)} cheaper` : a.priceDiff>0? `${formatMinorAmount(a.priceDiff, currencyCode, locale, minorUnitExponent)} more`:"Same price"} • Different listing — verify size/spec before buying.</span>
              </a>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">No same-category alternatives in stock right now.</p>}

        {loggedIn && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="font-semibold text-sm">Add to a shopping list</h4>
            <div className="flex gap-2 mt-2">
              <select value={listId} onChange={e=>setListId(e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-slate-200">
                {lists.map((l:any)=>(<option key={l.id} value={l.id}>{l.name}</option>))}
                {lists.length===0 && <option value="">No lists yet</option>}
              </select>
              <button onClick={addToList} disabled={!currencySupported} className="h-10 px-5 rounded-full bg-live-black text-white text-sm font-semibold disabled:opacity-50" title={!currencySupported ? "This listing's currency is not supported in the active market." : undefined}>Add</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Reviews {allReviews.length? `• ${(allReviews.reduce((s:any,r:any)=>s+r.rating,0)/allReviews.length).toFixed(1)}★ avg`:""}</h3>
        <div className="mt-3 space-y-2 max-h-56 overflow-auto">
          {allReviews.map((r:any)=>(
            <div key={r.id} className="bg-slate-50 rounded-xl p-3 text-sm">
              <div className="font-semibold">{"★".repeat(r.rating)} <span className="text-slate-500 font-normal">by {r.author?.name||"Customer"}</span> {r.verifiedPurchase && <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">Verified purchase</span>}</div>
              <div className="text-slate-600">{r.text}</div>
            </div>
          ))}
          {allReviews.length===0 && <p className="text-sm text-slate-500">No reviews yet. Reviews from collected reservations are marked “Verified purchase”.</p>}
        </div>
        {loggedIn ? (
          <form onSubmit={submitReview} className="mt-4">
            <label className="text-xs font-semibold uppercase text-slate-500">Your rating</label>
            <div className="flex gap-1 mt-1">{[1,2,3,4,5].map(n=>(<button type="button" key={n} onClick={()=>setRating(n)} className={`text-2xl ${n<=rating?"text-amber-500":"text-slate-300"}`} aria-label={`${n} stars`}>★</button>))}</div>
            <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="How was availability, price accuracy, service?" className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" rows={2}/>
            <button className="mt-2 h-10 px-6 rounded-full bg-live-green-ink text-white text-sm font-semibold">Post review</button>
          </form>
        ) : <p className="mt-3 text-sm text-slate-500"><a href="/auth/login" className="underline font-semibold">Sign in</a> to review.</p>}
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
