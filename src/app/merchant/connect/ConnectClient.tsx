"use client";
import { useEffect, useState } from "react";
import MerchantGeographyFields from "@/components/MerchantGeographyFields";
import { formatNaira } from "@/lib/utils";

export default function ConnectClient({ merchant }: any){
  const mid=merchant.id;
  const [msg,setMsg]=useState("");
  const [branches,setBranches]=useState<any[]>([]);
  const [team,setTeam]=useState<any>(null);
  const [services,setServices]=useState<any[]>([]);
  const [integrations,setIntegrations]=useState<any[]>([]);
  const [webhooks,setWebhooks]=useState<any[]>([]);
  const [sub,setSub]=useState<any>(null);
  const [apiKeyOnce,setApiKeyOnce]=useState("");
  const [webhookSecretOnce,setWebhookSecretOnce]=useState("");
  const [keys,setKeys]=useState<any[]>([]);
  const canManage = ["OWNER","MANAGER"].includes(team?.myRole);

  const load=async()=>{
    const [b,t,s,i,w,subR,keyR]=await Promise.all([
      fetch(`/api/merchant/branches?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/merchant/team?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/services?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/integrations?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/webhooks?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/merchant/subscription?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/api-keys?merchantId=${mid}`).then(r=>r.json()).catch(()=>({})),
    ]);
    setBranches(b.branches||[]); setTeam(t); setServices(s.services||[]); setIntegrations(i.integrations||[]); setWebhooks(w.webhooks||[]); setSub(subR); setKeys(keyR.keys||[]);
  };
  useEffect(()=>{ load(); },[]);

  const revokeKey=async(id:string)=>{
    const response=await fetch(`/api/api-keys?id=${encodeURIComponent(id)}`,{method:"DELETE"});
    const data=await response.json().catch(()=>({}));
    setMsg(response.ok?"API key revoked.":(data.error||"Key was not revoked."));
    if(response.ok) load();
  };

  const post=async(url:string, body:any)=>{
    const res=await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(body)});
    const d=await res.json();
    setMsg(res.ok? "Saved ✓" : (d.error||"Failed"));
    if(res.ok) load();
    return {res,d};
  };

  return (
    <div className="mt-6 space-y-4">
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-2 text-sm">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Branches */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">🏬 Branches</h3>
          <p className="text-xs text-slate-500 mt-1">Each branch has its own address/hours. A reservation always belongs to a specific branch/store — branch stock is never confused with organisation-wide totals.</p>
          <div className="mt-3 space-y-2">{branches.map(b=>(<div key={b.id} className="bg-slate-50 rounded-xl p-3 text-sm"><b>{b.name}</b> — {[b.cityArea?.name, b.lga?.name || b.area, b.state?.name].filter(Boolean).join(" · ")}<div className="text-slate-500">{b.address} • {b.storeStatus}</div></div>))}{!branches.length && <p className="text-sm text-slate-500">No extra branches yet. Your main store is branch #1.</p>}</div>
          {canManage&&<form onSubmit={e=>{e.preventDefault(); const form=e.currentTarget; const f=new FormData(form); post("/api/merchant/branches",{ merchantId:mid, name:f.get("name"), address:f.get("address"), stateCode:f.get("stateCode"), lgaCode:f.get("lgaCode"), cityCode:f.get("cityCode"), phone:f.get("phone") }); }} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="name" required placeholder="Branch name" className="h-10 px-3 rounded-xl border border-slate-200 col-span-2" maxLength={120}/>
              <input name="address" required placeholder="Public branch address or landmark" className="h-10 px-3 rounded-xl border border-slate-200 col-span-2" maxLength={240}/>
              <input name="phone" placeholder="Branch phone (optional)" className="h-10 px-3 rounded-xl border border-slate-200 col-span-2" maxLength={32}/>
            </div>
            <MerchantGeographyFields stateCode={merchant.stateCode || ""} lgaCode={merchant.lgaCode || ""} cityCode={merchant.cityCode || ""}/>
            <button className="min-h-10 w-full rounded-full bg-live-black text-white text-sm font-semibold">Add separately located branch</button>
          </form>}
        </section>

        {/* Team */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">👥 Team & roles {team?.myRole && <span className="text-xs bg-slate-100 rounded-full px-2 py-0.5">You: {team.myRole}</span>}</h3>
          <p className="text-xs text-slate-500 mt-1">Owner = everything • Manager = stock+orders+team • Inventory staff = stock only • Reservation staff = orders only • Read-only = reports. Enforced on the server.</p>
          <div className="mt-3 space-y-2">{team?.members?.map((m:any)=>(<div key={m.id} className="flex justify-between bg-slate-50 rounded-xl p-3 text-sm"><span>{m.name} ({m.email})</span><b>{m.role}</b></div>))}</div>
          {canManage&&<form onSubmit={e=>{e.preventDefault(); const f=new FormData(e.currentTarget); post("/api/merchant/team",{ merchantId:mid, emailOrPhone:f.get("who"), role:f.get("role") });}} className="mt-3 flex gap-2">
            <input name="who" required placeholder="Staff email/phone (must have a Live account)" className="flex-1 h-10 px-3 rounded-xl border border-slate-200"/>
            <select name="role" className="h-10 px-3 rounded-xl border border-slate-200"><option>MANAGER</option><option>INVENTORY_STAFF</option><option>RESERVATION_STAFF</option><option>READ_ONLY</option></select>
            <button className="h-10 px-5 rounded-full bg-live-green-ink text-white text-sm font-semibold">Add</button>
          </form>}
        </section>

        {/* Services */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">🗓️ Bookable services</h3>
          <div className="mt-3 space-y-2">{services.map(s=>(<div key={s.id} className="bg-slate-50 rounded-xl p-3 text-sm"><b>{s.name}</b> {s.price !== null ? `• ${formatNaira(s.price)}` : ""} {s.durationMin?`• ${s.durationMin} min`:""}</div>))}{!services.length && <p className="text-sm text-slate-500">No services yet.</p>}</div>
          {canManage&&<form onSubmit={e=>{e.preventDefault(); const f=new FormData(e.currentTarget); post("/api/services",{ merchantId:mid, name:f.get("name"), description:f.get("desc"), price:f.get("price"), durationMin:Number(f.get("mins"))||null, capacity:Number(f.get("capacity"))||1 }); e.currentTarget.reset();}} className="mt-3 grid grid-cols-2 gap-2">
            <input name="name" required placeholder="e.g. Car inspection" className="h-10 px-3 rounded-xl border border-slate-200"/>
            <input name="price" placeholder="Price ₦" className="h-10 px-3 rounded-xl border border-slate-200"/>
            <input name="desc" placeholder="Description" className="h-10 px-3 rounded-xl border border-slate-200"/>
            <input name="mins" type="number" min="5" max="1440" placeholder="Duration minutes" className="h-10 px-3 rounded-xl border border-slate-200"/>
            <input name="capacity" type="number" min="1" max="100" defaultValue="1" placeholder="Concurrent capacity" className="h-10 px-3 rounded-xl border border-slate-200"/>
            <button className="h-10 rounded-full bg-live-black text-white text-sm font-semibold col-span-2">Publish service</button>
          </form>}
        </section>

        {/* Customize */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">🎨 Storefront</h3>
          {canManage&&<form onSubmit={async e=>{e.preventDefault(); const f=new FormData(e.currentTarget); const res=await fetch("/api/merchant/customize",{ method:"PUT", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ merchantId:mid, description:f.get("desc"), whatsapp:f.get("wa") })}); const d=await res.json(); setMsg(res.ok?"Storefront updated ✓":d.error);}} className="mt-3 space-y-2">
            <input name="desc" defaultValue={merchant.description||""} placeholder="Business description" className="w-full h-10 px-3 rounded-xl border border-slate-200"/>
            <input name="wa" defaultValue={merchant.whatsapp||""} placeholder="WhatsApp number" className="w-full h-10 px-3 rounded-xl border border-slate-200"/>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Delivery integrations are not configured. Live does not verify or arrange delivery; contact a seller directly about any seller-managed option.</p>
            <button className="h-10 px-6 rounded-full bg-live-black text-white text-sm font-semibold">Save storefront</button>
            <span className="block text-xs text-slate-400">Verification & reliability badges cannot be edited here.</span>
          </form>}
        </section>
      </div>

      <section className="bg-live-black text-white rounded-2xl p-5">
        <h3 className="font-bold">🔌 Integrations, webhooks & API (Live Connect)</h3>
        <div className="grid md:grid-cols-3 gap-4 mt-4 text-sm">
          <div className="bg-white/10 rounded-xl p-4">
            <b>POS / delivery adapters</b>
            <div className="mt-2 space-y-1">{integrations.map((i:any)=>(<div key={i.id}>{i.name} ({i.provider}) — <b>{i.status}</b>{i.lastSyncAt?` • last sync ${new Date(i.lastSyncAt).toLocaleString()}`:""}</div>))}{!integrations.length && <span className="text-white/60">None connected.</span>}</div>
            {canManage&&<form onSubmit={e=>{e.preventDefault(); const f=new FormData(e.currentTarget); post("/api/integrations",{ merchantId:mid, provider:f.get("provider"), name:f.get("name") }); e.currentTarget.reset();}} className="mt-3 flex gap-2">
              <select name="provider" className="h-10 px-2 rounded-xl text-slate-900"><option>POS</option><option>DELIVERY</option><option>SUPPLIER</option></select>
              <input name="name" required placeholder="e.g. Square POS" className="flex-1 h-10 px-3 rounded-xl text-slate-900"/>
              <button className="h-10 px-4 rounded-full bg-live-green-ink text-white font-semibold">Register disconnected record</button>
            </form>}
            <p className="text-[11px] text-white/50 mt-2">Status stays DISCONNECTED until real provider credentials are added & tested. See docs/INTEGRATIONS.md for auth, mapping, retries & reconciliation.</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <b>Webhooks</b>
            <div className="mt-2 space-y-1">{webhooks.map((w:any)=>(<div key={w.id} className="break-all">{w.url} — {w.events}</div>))}{!webhooks.length && <span className="text-white/60">None yet.</span>}</div>
            {canManage&&<form onSubmit={async e=>{e.preventDefault(); const form=e.currentTarget; const f=new FormData(form); const {res,d}=await post("/api/webhooks",{ merchantId:mid, url:f.get("url"), events:[f.get("event")] }); if(res.ok&&d.webhook?.secret) setWebhookSecretOnce(d.webhook.secret); if(res.ok) form.reset();}} className="mt-3 space-y-2">
              <input name="url" type="url" required placeholder="https://your-system.com/live" className="w-full h-10 px-3 rounded-xl text-slate-900"/>
              <select name="event" className="w-full h-10 px-3 rounded-xl text-slate-900"><option value="batch.created">batch.created</option><option value="batch.updated">batch.updated</option><option value="transfer.acknowledged">transfer.acknowledged</option></select>
              <button className="h-10 px-4 rounded-full bg-white text-slate-900 font-semibold">Create webhook</button>
            </form>}
            {webhookSecretOnce&&<p className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/20 p-2 break-all text-xs">Copy signing secret now (shown once): <b>{webhookSecretOnce}</b></p>}
            <p className="text-[11px] text-white/50 mt-2">Only the listed durable event types are emitted today. Payloads are HMAC-signed, but attempts and failure states are not a guarantee of partner processing.</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <b>API credentials</b>
            <p className="text-white/60 mt-1">Credential creation stores a hash and shows the raw value once, but no API route accepts it yet, so it grants no access today. Public reads remain unauthenticated; private/write scopes are not enabled.</p>
            <div className="mt-2 space-y-2">{keys.map((key:any)=><div key={key.id} className="flex items-center justify-between gap-2 text-xs"><span>{key.name} · {key.prefix} · {key.revoked?"revoked":"active"}</span>{!key.revoked&&["OWNER","MANAGER"].includes(team?.myRole)&&<button onClick={()=>void revokeKey(key.id)} className="underline">Revoke</button>}</div>)}</div>
            <button disabled={!['OWNER','MANAGER'].includes(team?.myRole)} onClick={async()=>{ const {d}=await post("/api/api-keys",{ name:`${merchant.businessName} key`, scopes:"read", merchantId:mid }); if(d.apiKey) setApiKeyOnce(d.apiKey); }} className="mt-3 h-10 px-5 rounded-full bg-live-green-ink text-white font-semibold disabled:opacity-50">Create inactive API credential</button>
            {apiKeyOnce && <p className="mt-2 bg-amber-400/20 border border-amber-300/30 rounded-lg p-2 break-all text-xs">Copy now (shown once): <b>{apiKeyOnce}</b></p>}
            <div className="mt-3"><b>Plan:</b> {sub?.subscription?.plan||"FREE"} ({sub?.subscription?.status||"ACTIVE"}) • {sub?.usage?.listings??0} listings
              <div className="mt-2 space-y-1">{Object.entries(sub?.plans||{}).map(([k,v]:any)=><div key={k} className="text-xs text-white/75">{v.name} — {v.priceNGN===0?"Free":`₦${v.priceNGN.toLocaleString()}/mo`}{k===sub?.subscription?.plan?" · current":" · not selectable here"}</div>)}</div>
              <p className="text-[11px] text-white/50 mt-2">Paid plans cannot be activated until checkout and server-verified payment handling are implemented. {sub?.note}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
