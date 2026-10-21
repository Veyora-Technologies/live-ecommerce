"use client";
import { useEffect, useState } from "react";

export default function ProfileSettings({ recentProducts }: { recentProducts: any[] }){
  const [prefs,setPrefs]=useState<any>(null);
  const [searches,setSearches]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  const [saving,setSaving]=useState("");

  const load=async()=>{
    const [p,s]=await Promise.all([
      fetch("/api/notifications/preferences").then(r=>r.json()).catch(()=>null),
      fetch("/api/saved-searches").then(r=>r.json()).catch(()=>({savedSearches:[]})),
    ]);
    setPrefs(p?.preferences); setSearches(s.savedSearches||[]);
  };
  useEffect(()=>{ load(); },[]);

  const toggle=async(key:string)=>{
    if(!prefs || saving) return;
    const previous=prefs[key];
    const next={ ...prefs, [key]: !previous };
    setPrefs(next); setSaving(key); setMsg("");
    try {
      const res=await fetch("/api/notifications/preferences",{ method:"PUT", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ [key]: next[key] })});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Could not save preference.");
      setPrefs(data.preferences); setMsg("Preferences saved.");
    } catch (error) {
      setPrefs((current:any)=>({ ...current, [key]: previous }));
      setMsg(error instanceof Error ? error.message : "Could not save preference; the previous setting remains active.");
    } finally { setSaving(""); }
  };

  const labels: [string,string][] = [
    ["pushEnabled","In-app availability and price-alert delivery"],["emailEnabled","Email preference (provider not configured)"],
    ["alertsForAvailable","Tell me when saved items are reported available"],["alertsForPriceChange","Price-change alerts"],
    ["smsEnabled","SMS preference (provider not configured)"],["whatsappEnabled","WhatsApp preference (provider not configured)"],
  ];

  return (
    <div className="mt-6 grid md:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">Notification preferences</h3>
        <p className="text-xs text-slate-500 mt-1">These saved settings govern the alert pipeline where implemented. Transaction notices remain in Activity; email, SMS, WhatsApp, and push providers are not configured, so no external delivery is claimed.</p>
        {prefs? <div className="mt-3 space-y-1">{labels.map(([k,l])=>(
          <label key={k} className="flex justify-between items-center bg-slate-50 rounded-xl px-3 py-2.5 text-sm cursor-pointer">{l}
            <input type="checkbox" checked={!!prefs[k]} disabled={saving!==""} onChange={()=>void toggle(k)} className="w-5 h-5"/>
          </label>
        ))}</div> : <p className="text-sm text-slate-500 mt-2">Loading…</p>}
        {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
      </div>
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Saved searches & alerts</h3>
          <div className="mt-2 space-y-2">{searches.map(s=>(<a key={s.id} href={`/search?q=${encodeURIComponent(s.query)}`} className="flex justify-between bg-slate-50 rounded-xl px-3 py-2.5 text-sm"><span>“{s.query}”</span><span>{s.alertEnabled?"🔔 alert on":"🔕"}</span></a>))}{!searches.length && <p className="text-sm text-slate-500">Run a search and tap “Save + alert me”.</p>}</div>
        </div>
        <div className="bg-live-black text-white rounded-2xl p-5">
          <h3 className="font-bold">Reorder regulars</h3>
          <p className="text-xs text-white/60 mt-1">From your collected reservations — availability is re-checked live on the product page.</p>
          <div className="mt-3 space-y-2">{recentProducts.map((p:any)=>(<a key={p.id} href={`/product/${p.id}`} className="flex justify-between bg-white/10 rounded-xl px-3 py-2.5 text-sm"><span>{p.name}</span><span className="font-semibold">Reorder →</span></a>))}{!recentProducts.length && <p className="text-sm text-white/70">Complete a pickup and it will appear here for one-tap reordering.</p>}</div>
        </div>
      </div>
    </div>
  );
}
