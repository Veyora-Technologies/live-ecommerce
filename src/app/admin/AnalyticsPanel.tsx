"use client";
import { useEffect, useState } from "react";

export default function AnalyticsPanel(){
  const [data,setData]=useState<any>(null);
  const [flags,setFlags]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  const load=async()=>{
    const [a,f]=await Promise.all([
      fetch("/api/admin/analytics").then(r=>r.json()).catch(()=>null),
      fetch("/api/admin/flags").then(r=>r.json()).catch(()=>({flags:[]})),
    ]);
    setData(a); setFlags(f.flags||[]);
  };
  useEffect(()=>{ load(); },[]);

  const toggleFlag=async(flag:any)=>{
    const res=await fetch("/api/admin/flags",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ key:flag.key, name:flag.name, enabled:!flag.enabled })});
    setMsg(res.ok? `${flag.key} ${!flag.enabled?"enabled":"disabled"}`:"Failed");
    load();
  };
  const seedFlags=async()=>{
    for(const [key,name] of [["assist_enabled","Live Assist"],["image_search_enabled","Camera search"],["sponsored_discovery","Sponsored discovery (labelled)"],["services_enabled","Service bookings"]])
      await fetch("/api/admin/flags",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ key, name, enabled: key!=="sponsored_discovery" })});
    load();
  };
  const runJobs=async(path:string)=>{
    const res=await fetch(path,{ method:"POST", headers:{ "Content-Type":"application/json"}, body:"{}" });
    const d=await res.json();
    setMsg(JSON.stringify(d)); load();
  };

  if(!data) return <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500 animate-pulse">Loading platform intelligence…</div>;
  const p=data.platform;
  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Users",p.totalUsers],["Merchants",`${p.totalMerchants} (${p.pendingMerchants} pending)`],["Products",p.totalProducts],["Reservations",p.totalReservations],["Stale products",`${p.staleProducts} (${p.staleRate}%)`],["Failed jobs",data.ops.failedJobs],["Webhook failures",data.ops.webhookFailures],["Verification queue",p.pendingMerchants]].map(([l,v])=>(
          <div key={String(l)} className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-xs font-semibold uppercase text-slate-500">{l}</div><div className="text-xl font-black mt-1">{v}</div></div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Reservations by status</h3>
          <div className="mt-2 space-y-1 text-sm">{data.reservationsByStatus.map((r:any)=>(<div key={r.status} className="flex justify-between border-b border-slate-50 py-1"><span>{r.status}</span><b>{r._count}</b></div>))}</div>
          <h3 className="font-bold mt-5">Search demand (aggregated)</h3>
          <div className="mt-2 space-y-1 text-sm">{data.demand.map((d:any)=>(<div key={d.id} className="flex justify-between border-b border-slate-50 py-1"><span>“{d.query}” {d.area?`• ${d.area}`:""}</span><b>{d.count}</b></div>))}{!data.demand.length && <span className="text-slate-500">No demand recorded yet.</span>}</div>
          <div className="flex flex-wrap gap-2 mt-5">
            <button onClick={()=>runJobs("/api/jobs/expire")} className="px-4 py-2 rounded-full bg-live-black text-white text-sm font-semibold">Expire stale reservations</button>
            <button onClick={()=>runJobs("/api/jobs/process")} className="px-4 py-2 rounded-full bg-white border border-slate-300 text-sm font-semibold">Process jobs & webhooks</button>
          </div>
          {msg && <p className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 break-all">{msg}</p>}
        </div>
        <div className="bg-live-black text-white rounded-2xl p-5">
          <h3 className="font-bold">Feature flags — disable a feature without downtime</h3>
          <div className="mt-3 space-y-2">
            {flags.map(f=>(<div key={f.id} className="flex justify-between items-center bg-white/10 rounded-xl px-3 py-2 text-sm"><span>{f.name} <span className="text-white/50">({f.key})</span></span><button onClick={()=>toggleFlag(f)} className={`px-3 py-1 rounded-full text-xs font-bold ${f.enabled?"bg-emerald-500 text-white":"bg-white/20 text-white"}`}>{f.enabled?"ON":"OFF"}</button></div>))}
            {!flags.length && <p className="text-white/60 text-sm">No flags yet.</p>}
          </div>
          <button onClick={seedFlags} className="mt-3 px-4 py-2 rounded-full bg-white text-slate-900 text-sm font-semibold">Create default flags</button>
          <p className="text-xs text-white/50 mt-3">Risk note: repeated cancellations, extreme price jumps and duplicate merchants should be reviewed by a human before suspension. Automated signals never auto-punish serious cases here.</p>
        </div>
      </div>
    </div>
  );
}
