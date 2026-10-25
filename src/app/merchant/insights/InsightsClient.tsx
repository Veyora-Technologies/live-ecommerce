"use client";
import { useEffect, useState } from "react";
import { formatNaira } from "@/lib/utils";

export default function InsightsClient({ merchantId }: { merchantId: string }){
  const [data,setData]=useState<any>(null);
  const [err,setErr]=useState("");
  useEffect(()=>{ fetch(`/api/merchant/insights?merchantId=${merchantId}`).then(async r=>{ const d=await r.json(); if(!r.ok) throw new Error(d.error||"Failed"); setData(d); }).catch(e=>setErr(e.message)); },[merchantId]);

  const exportCsv=()=>{
    if(!data) return;
    const rows=[["metric","value"]];
    const o=data.insights.overview;
    Object.entries(o).forEach(([k,v])=> rows.push([k, String(v??"not tracked")]));
    rows.push(["",""],["unmet demand (aggregated, min 3 searches)","count"]);
    data.insights.unmetDemand?.forEach((d:any)=> rows.push([d.query, String(d.count)]));
    rows.push(["",""],["top product","reservations"]);
    data.insights.topProducts?.forEach((t:any)=> rows.push([t.name, String(t.count)]));
    const blob=new Blob([rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n")],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="live-insights.csv"; a.click();
  };

  if(err) return <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-800">{err} <button className="underline" onClick={()=>window.location.reload()}>Retry</button></div>;
  if(!data) return <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-8 text-sm text-slate-500 animate-pulse">Loading insights…</div>;
  const o=data.insights.overview, s=data.insights.stock;
  const trendEntries=Object.entries(data.trends||{}).sort().slice(-14) as [string,number][];
  const maxTrend=Math.max(1,...trendEntries.map(([,v])=>v));

  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Reservations", o.totalReservations, `${o.pending} pending`],
          ["Confirmation rate", o.confirmationRate!==null? `${o.confirmationRate}%`:"—", "confirmed ÷ requested"],
          ["Fulfilment rate", o.fulfilmentRate!==null? `${o.fulfilmentRate}%`:"—", "collected ÷ requested"],
          ["Collected value", formatNaira(o.revenueCollectedKobo||0), "collected reservations only"],
          ["Products", o.totalProducts, `${s.lowStock.length} low • ${s.outOfStock.length} out`],
          ["Stale (>24h)", s.stale.length, "re-confirm to stay trusted"],
          ["Reviews", o.reviewCount, o.averageRating? `${o.averageRating}★ average`:"no reviews yet"],
          ["Views → conversion", "Not tracked", "we don't invent impressions"],
        ].map(([label,val,sub])=>(
          <div key={String(label)} className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="text-2xl font-black mt-1">{val}</div><div className="text-xs text-slate-400">{sub}</div></div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Reservation activity by day</h3>
          {trendEntries.length? <div className="mt-4 flex items-end gap-1.5 h-32">{trendEntries.map(([day,v])=>(<div key={day} className="flex-1 flex flex-col items-center gap-1"><div className="w-full bg-live-green-ink rounded-t" style={{height:`${Math.max(8,v/maxTrend*110)}px`}} title={`${day}: ${v}`}/><span className="text-[9px] text-slate-400">{day.slice(5)}</span></div>))}</div>
          : <p className="text-sm text-slate-500 mt-2">No reservations recorded yet.</p>}
          <h3 className="font-bold mt-5">Best performers (real reservations)</h3>
          <div className="mt-2 space-y-1 text-sm">{data.insights.topProducts?.map((t:any)=>(<div key={t.name} className="flex justify-between border-b border-slate-50 py-1"><span>{t.name}</span><b>{t.count}</b></div>))}{!data.insights.topProducts?.length && <span className="text-slate-500">No data yet.</span>}</div>
        </div>

        <div className="bg-live-black text-white rounded-2xl p-5">
          <h3 className="font-bold">Unmet demand near you</h3>
          <p className="text-xs text-white/60 mt-1">Aggregated searches (groups under 3 hidden for privacy). No individual search histories are ever shared.</p>
          <div className="mt-3 space-y-2">
            {data.insights.unmetDemand?.map((d:any)=>(<div key={d.id} className="bg-white/10 rounded-xl px-3 py-2 text-sm flex justify-between"><span>“{d.query}” {d.area?`• ${d.area}`:""}</span><b>{d.count} searches</b></div>))}
            {!data.insights.unmetDemand?.length && <p className="text-sm text-white/70">Not enough aggregated demand yet, or your catalogue already covers the top searches.</p>}
          </div>
          <h3 className="font-bold mt-5">Advisory stock actions</h3>
          <div className="mt-2 space-y-2 text-sm">
            {data.insights.recommendations?.map((r:any)=>(<div key={r.productId} className="bg-amber-400/15 border border-amber-300/20 rounded-xl px-3 py-2"><b>{r.name}</b> — {r.risk} risk<div className="text-xs text-white/70">{r.note} Advisory only — Furnivo never orders stock for you.</div></div>))}
            {!data.insights.recommendations?.length && <p className="text-white/70">No stockout signals from current quantities and pace.</p>}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1"><b>Business report</b><div className="text-xs text-slate-500">Exports actual stored figures. Estimates (risk notes) are labelled separately in the dashboard and excluded from totals.</div></div>
        <button onClick={exportCsv} className="h-10 px-6 rounded-full bg-live-black text-white text-sm font-semibold">⬇ Export CSV</button>
        <a href={`/merchant/bulk?merchantId=${encodeURIComponent(merchantId)}`} className="h-10 px-6 grid place-items-center rounded-full bg-white border border-slate-300 text-sm font-semibold">Branch stock CSV tools</a>
      </div>
    </div>
  );
}
