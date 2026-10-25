"use client";
import { useMemo, useState } from "react";
import { formatNaira } from "@/lib/utils";
import { availabilityConfidence } from "@/lib/confidence";

export default function ListDetail({ initial, products }: any){
  const [list,setList]=useState(initial);
  const [sel,setSel]=useState(products[0]?.id||"");
  const [custom,setCustom]=useState("");
  const [qty,setQty]=useState(1);
  const [invite,setInvite]=useState("");
  const [msg,setMsg]=useState("");
  const [checking,setChecking]=useState(false);
  const [check,setCheck]=useState<any>(null);

  const estimate = useMemo(() => {
    let minor = 0n;
    let complete = true;
    for (const item of list.items || []) {
      if (!item.product || !item.product.priceAvailable || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.product.price) || item.product.price < 0) {
        complete = false;
        continue;
      }
      minor += BigInt(item.product.price) * BigInt(item.quantity);
    }
    return { minor, complete };
  }, [list]);
  const total = estimate.minor;

  const addItem=async(kind:string)=>{
    const body = kind==="product" ? { productId: sel, quantity: qty } : { customName: custom, quantity: qty };
    if(kind==="custom" && !custom.trim()) return;
    const res=await fetch(`/api/lists/${list.id}`,{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(body)});
    const data=await res.json();
    if(res.ok){ setMsg("Added"); window.location.reload(); } else setMsg(data.error);
  };
  const toggle=async(item:any)=>{
    const res=await fetch(`/api/lists/${list.id}`,{ method:"PATCH", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ itemId: item.id, checked: !item.checked })});
    if(res.ok) window.location.reload();
  };
  const inviteUser=async(e:any)=>{
    e.preventDefault();
    const res=await fetch(`/api/lists/${list.id}/members`,{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ emailOrPhone: invite })});
    const data=await res.json();
    setMsg(res.ok? "Invited" : data.error);
  };
  const runCheck=async()=>{
    setChecking(true);
    const res=await fetch(`/api/lists/${list.id}`);
    const data=await res.json();
    setChecking(false);
    setCheck(data.list);
  };

  return (
    <div className="mt-6 grid md:grid-cols-2 gap-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Items • {estimate.complete ? "Total estimate" : "Known-price estimate"} {formatNaira(total)}</h3>
        {list.spendingLimit !== null && (estimate.complete
          ? <p className={`text-xs mt-1 ${total <= BigInt(list.spendingLimit) ? "text-emerald-700" : "text-red-700"}`}>{total <= BigInt(list.spendingLimit) ? "Within budget" : `Over budget by ${formatNaira(total - BigInt(list.spendingLimit))}`}</p>
          : <p className="mt-1 text-xs text-amber-800">Budget status unavailable because one or more item prices are missing or not supported in this market.</p>)}
        <div className="mt-3 space-y-2">
          {(list.items||[]).map((it:any)=>{
            const conf = it.product ? availabilityConfidence(it.product) : null;
            return (
              <label key={it.id} className="flex gap-3 bg-slate-50 rounded-xl p-3 text-sm cursor-pointer">
                <input type="checkbox" checked={it.checked} onChange={()=>toggle(it)} className="mt-1"/>
                <span className="flex-1">
                  <span className={`font-semibold ${it.checked?"line-through text-slate-400":""}`}>{it.product?.name||it.customName} ×{it.quantity}</span>
                  {it.product && <span className="block text-xs text-slate-500">{it.product.merchant?.businessName} • {it.product.availability} • {conf?.label} • {it.product.priceAvailable ? formatNaira(BigInt(it.product.price) * BigInt(it.quantity)) : `Price unavailable in ${it.product.currencyCode}; Furnivo has not converted it.`}</span>}
                </span>
              </label>
            );
          })}
          {(!list.items||list.items.length===0) && <p className="text-sm text-slate-500">No items yet.</p>}
        </div>
        <button onClick={runCheck} disabled={checking} className="mt-4 w-full h-11 rounded-full bg-live-black text-white font-semibold">{checking?"Checking stock…":"Check full-list availability"}</button>
        {check && <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-900">{check.costEstimateComplete ? "Estimate" : "Known-price estimate"} {formatNaira(check.totalEstimate)} across {(check.items || []).length} items. {check.costEstimateComplete ? "" : "Some items have no supported price, so this is not a complete total or budget check. "}Items are sourced per merchant — Furnivo does not claim this is one combined checkout. Reserve each item with its own merchant.</div>}
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Add item</h3>
          <select value={sel} onChange={e=>setSel(e.target.value)} className="mt-3 w-full h-11 px-3 rounded-xl border border-slate-200">
            {products.map((p:any)=>(<option key={p.id} value={p.id}>{p.name} — {p.merchant.businessName} ({formatNaira(p.price)})</option>))}
          </select>
          <div className="flex gap-2 mt-2">
            <input type="number" min={1} value={qty} onChange={e=>setQty(parseInt(e.target.value)||1)} className="w-24 h-11 px-3 rounded-xl border border-slate-200"/>
            <button onClick={()=>addItem("product")} className="flex-1 h-11 rounded-full bg-live-green-ink text-white font-semibold">Add product</button>
          </div>
          <input value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Or custom item, e.g. Fresh tomatoes 1kg" className="mt-3 w-full h-11 px-3 rounded-xl border border-slate-200"/>
          <button onClick={()=>addItem("custom")} className="mt-2 w-full h-11 rounded-full bg-white border border-slate-300 font-semibold">Add custom item</button>
          {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
        </div>
        <form onSubmit={inviteUser} className="bg-slate-900 text-white rounded-2xl p-5">
          <h3 className="font-bold">Share with family / group</h3>
          <p className="text-xs text-white/70 mt-1">Only invited members can see this list. Invite by the email or phone they registered with.</p>
          <div className="flex gap-2 mt-3">
            <input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="emeka@example.com" className="flex-1 h-11 px-3 rounded-xl text-slate-900"/>
            <button className="h-11 px-5 rounded-full bg-live-green-ink text-white font-semibold">Invite</button>
          </div>
          <div className="mt-3 text-xs text-white/70">Members: {(list.members||[]).map((m:any)=>m.user?.name||m.userId).join(", ")||"—"}</div>
        </form>
      </div>
    </div>
  );
}
