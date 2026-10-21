"use client";
import { useState } from "react";
import { formatNaira } from "@/lib/utils";
import { parseMajorAmountToMinor } from "@/lib/money";

export default function RequestsClient({ myRequests, openDemand }: any){
  const [productName,setPN]=useState("");
  const [category,setCat]=useState("");
  const [area,setArea]=useState("Wuse");
  const [quantity,setQ]=useState(1);
  const [maxBudget,setBudget]=useState("");
  const [msg,setMsg]=useState<any>(null);
  const [list,setList]=useState(myRequests);

  const submit=async(e:any)=>{
    e.preventDefault();
    const maxBudgetMinor = maxBudget.trim() ? parseMajorAmountToMinor(maxBudget.trim(), 2) : null;
    if (maxBudget.trim() && (maxBudgetMinor === null || maxBudgetMinor < 0n || maxBudgetMinor > 1_000_000_000n)) {
      setMsg({ error: "Enter a nonnegative budget in naira with no more than two decimal places." });
      return;
    }
    const res=await fetch("/api/item-requests",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ productName, category, quantity, area, maxBudget: maxBudgetMinor === null ? null : Number(maxBudgetMinor) })});
    const data=await res.json();
    if(!res.ok){
      setMsg(data);
    } else {
      setMsg({ ok:`Request created! Merchants in ${area} notified. Status: ${data.request.status}`});
      setList([data.request, ...list]);
    }
  };

  return (
    <div className="mt-6 grid md:grid-cols-2 gap-6">
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="font-bold">New request</h3>
        <input value={productName} onChange={e=>setPN(e.target.value)} placeholder="Product name e.g. Baby formula 400g" className="mt-3 w-full h-11 px-4 rounded-xl border border-slate-200" required />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <input value={category} onChange={e=>setCat(e.target.value)} placeholder="Category" className="h-11 px-4 rounded-xl border border-slate-200" />
          <input value={area} onChange={e=>setArea(e.target.value)} className="h-11 px-4 rounded-xl border border-slate-200" />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <input type="number" value={quantity} onChange={e=>setQ(parseInt(e.target.value))} className="h-11 px-4 rounded-xl border border-slate-200" />
          <input value={maxBudget} onChange={e=>setBudget(e.target.value)} inputMode="decimal" maxLength={14} placeholder="Max budget NGN (e.g. 2500.50)" className="h-11 px-4 rounded-xl border border-slate-200" />
        </div>
        <p className="mt-2 text-xs text-slate-500">We’ll search existing listings first to avoid duplicates. Privacy: only area & budget shared until you accept a merchant response.</p>
        <button className="mt-4 w-full h-11 rounded-full bg-live-black text-white font-semibold">Submit request</button>
        {msg && (
          <div className={`mt-3 rounded-xl p-3 text-sm ${msg.ok?"bg-emerald-50 border border-emerald-200 text-emerald-700":"bg-amber-50 border border-amber-200 text-amber-800"}`}>
            {msg.ok || msg.error}
            {msg.matches && <div className="mt-2">Matches: {msg.matches.map((m:any)=> `${m.name} at ${m.merchant} ${formatNaira(m.price)}`).join(" • ")}</div>}
          </div>
        )}
      </form>

      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">My requests • {list.length}</h3>
          <div className="mt-3 space-y-2">
            {list.map((r:any)=>(
              <div key={r.id} className="bg-slate-50 rounded-xl p-3 text-sm">
                <div className="font-semibold">{r.productName} ×{r.quantity} — {r.area} {r.maxBudget? `• ≤${formatNaira(r.maxBudget)}`:""}</div>
                <div className="text-xs text-slate-500">{r.status} • {new Date(r.createdAt).toLocaleString()}</div>
                {r.responses?.length>0 && <div className="mt-1 text-xs bg-white border border-slate-200 rounded-lg p-2">Merchant replies: {r.responses.map((x:any)=> x.message).join(" | ")}</div>}
              </div>
            ))}
            {list.length===0 && <div className="text-sm text-slate-500">No requests yet.</div>}
          </div>
        </div>
        <div className="bg-slate-900 text-white rounded-2xl p-5">
          <h3 className="font-bold">Statuses</h3>
          <div className="mt-2 text-sm text-white/80 space-y-1">
            <div>OPEN → Potential matches found → Merchant response → Fulfilled/Expired/Cancelled</div>
            <div className="text-xs text-white/60">Merchants cannot mark as available without real listing update.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
