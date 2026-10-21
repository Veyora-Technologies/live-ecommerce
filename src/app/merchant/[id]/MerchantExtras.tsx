"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/utils";

export default function MerchantExtras({ merchantId, services, reviews, loggedIn }: any){
  const [msg,setMsg]=useState("");
  const [slot,setSlot]=useState("");
  const [rating,setRating]=useState(5);
  const [text,setText]=useState("");
  const [allReviews,setReviews]=useState(reviews||[]);
  const [bookingHref,setBookingHref]=useState("");
  const [bookingBusy,setBookingBusy]=useState("");
  const idempotencyKeys=useRef<Record<string,string>>({});

  const book=async(serviceId:string)=>{
    if(bookingBusy) return;
    if(!slot){ setMsg("Pick a date & time first."); return; }
    if(new Date(slot).getTime() <= Date.now()){ setMsg("Choose a future appointment time."); return; }
    const idempotencyKey = idempotencyKeys.current[serviceId] || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    idempotencyKeys.current[serviceId]=idempotencyKey;
    setBookingBusy(serviceId);
    try {
      const res=await fetch(`/api/services/${serviceId}/bookings`,{ method:"POST", headers:{ "Content-Type":"application/json", "Idempotency-Key":idempotencyKey }, body: JSON.stringify({ startTime: new Date(slot).toISOString() })});
      const data=await res.json().catch(()=>({}));
      setMsg(res.ok? `Requested ✓ Status: ${data.booking.status} — a request is not confirmed until the provider confirms.` : (data.error||"Booking failed"));
      if(res.ok) { delete idempotencyKeys.current[serviceId]; setBookingHref("/activity?tab=appointments"); }
    } catch { setMsg("Connection failed. Check Activity before retrying; the same request key will be reused."); }
    finally { setBookingBusy(""); }
  };
  const review=async(e:any)=>{
    e.preventDefault();
    const res=await fetch("/api/reviews",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ merchantId, rating, text })});
    const data=await res.json();
    if(res.ok){ setReviews([data.review, ...allReviews]); setText(""); setMsg("Review posted."); } else setMsg(data.error);
  };
  const reportReview=async(id:string)=>{
    const reason=prompt("Why are you reporting this review? (spam, abuse, fake…)");
    if(!reason) return;
    const res=await fetch(`/api/reviews/${id}/report`,{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ reason })});
    setMsg(res.ok? "Reported for moderation.":"Could not report.");
  };

  return (
    <div className="mt-8 grid md:grid-cols-2 gap-4">
      <div id="merchant-services" className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Services & appointments</h3>
        {services?.length ? (
          <div className="mt-3 space-y-3">
            <input type="datetime-local" value={slot} onChange={e=>setSlot(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-slate-200" aria-label="Preferred date and time"/>
            {services.map((s:any)=>(
              <div key={s.id} className="bg-slate-50 rounded-xl p-4 flex gap-3 items-center">
                <div className="flex-1"><div className="font-semibold">{s.name}</div><div className="text-xs text-slate-500">{s.description} {s.durationMin?`• ~${s.durationMin} min`:""} {s.price !== null && s.price !== undefined?`• ${formatNaira(s.price)}`:""}</div></div>
                {loggedIn ? <button disabled={Boolean(bookingBusy)} onClick={()=>void book(s.id)} className="h-10 px-5 rounded-full bg-live-black text-white text-sm font-semibold disabled:opacity-50">{bookingBusy===s.id?"Requesting…":"Request slot"}</button> : <Link href={`/auth/login?next=${encodeURIComponent(`/merchant/${merchantId}#merchant-services`)}`} className="h-10 px-5 grid place-items-center rounded-full bg-live-black text-white text-sm font-semibold">Sign in to request</Link>}
              </div>
            ))}
            <p className="text-xs text-slate-500">Requested slots are never shown as confirmed until the provider confirms. Overlapping slots are blocked server-side.</p>
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">This merchant sells products for pickup/reservation and hasn’t published bookable services.</p>}
        {msg && <p className="mt-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2" role="status">{msg}</p>}
        {bookingHref && <Link href={bookingHref} className="mt-2 inline-block text-sm font-semibold text-emerald-800 underline">View appointment request in Activity</Link>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Customer reviews</h3>
        <div className="mt-3 space-y-2 max-h-64 overflow-auto">
          {allReviews.map((r:any)=>(
            <div key={r.id} className="bg-slate-50 rounded-xl p-3 text-sm">
              <div className="font-semibold">{"★".repeat(r.rating)} <span className="text-slate-500 font-normal">{r.author?.name}</span> {r.verifiedPurchase && <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">Verified purchase</span>}</div>
              <div className="text-slate-600">{r.text}</div>
              {loggedIn && <button onClick={()=>reportReview(r.id)} className="text-xs text-slate-400 underline">Report</button>}
            </div>
          ))}
          {allReviews.length===0 && <p className="text-sm text-slate-500">No reviews yet.</p>}
        </div>
        {loggedIn && (
          <form onSubmit={review} className="mt-4">
            <div className="flex gap-1">{[1,2,3,4,5].map(n=>(<button type="button" key={n} onClick={()=>setRating(n)} className={`text-2xl ${n<=rating?"text-amber-500":"text-slate-300"}`} aria-label={`${n} stars`}>★</button>))}</div>
            <textarea value={text} onChange={e=>setText(e.target.value)} className="mt-2 w-full border border-slate-200 rounded-xl p-3 text-sm" rows={2} placeholder="Was listed stock actually there? Was the price right?"/>
            <button className="mt-2 h-10 px-6 rounded-full bg-live-green-ink text-white text-sm font-semibold">Post review</button>
          </form>
        )}
      </div>
    </div>
  );
}
