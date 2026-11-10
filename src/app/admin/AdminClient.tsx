"use client";
import { useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/utils";
import BrandLogo from "@/components/BrandLogo";
export default function AdminClient({ user, merchants, reservations, reports, users, audit }: any){
  const [tab,setTab]=useState("merchants");
  const [list,setList]=useState(merchants);
  const [msg,setMsg]=useState("");

  const act=async(id:string, action:string)=>{
    const res=await fetch("/api/admin/merchants",{ method:"PATCH", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ id, action })});
    const data=await res.json();
    if(res.ok){
      setList(list.map((m:any)=> m.id===id? data.merchant: m));
      const actionLabel: Record<string, string> = { approve: "approved", reject: "rejected", suspend: "suspended", pending: "returned to pending review" };
      setMsg(`Merchant ${actionLabel[action] || "updated"}.`);
    } else setMsg(data.error);
    setTimeout(()=>setMsg(""),2000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-live-black text-white">
        <div className="mx-auto max-w-[1200px] px-4 h-16 flex items-center gap-4">
          <div className="flex items-center gap-3"><BrandLogo variant="inverse" width={126} height={38} /><span className="text-xs bg-white/10 border border-white/10 rounded-full px-2 py-0.5">ADMIN</span></div>
          <div className="ml-auto text-sm">Hello, {user.name} • <Link href="/" className="underline">Exit to store</Link></div>
        </div>
      </header>
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="flex gap-2 overflow-x-auto">
          {["analytics","merchants","reservations","reports","users","audit"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${tab===t?"bg-live-black text-white":"bg-white border border-slate-200"}`}>{t}</button>
          ))}
          {["REVIEWER", "SUPER"].includes(user.adminRole) && <Link href="/admin/marketplace" className="px-5 py-2 rounded-full bg-emerald-700 text-sm font-semibold whitespace-nowrap text-white">Marketplace listing review</Link>}
          {["SUPER", "SECURITY", "REVIEWER", "SUPPORT"].includes(user.adminRole) && <Link href="/admin/compliance" className="px-5 py-2 rounded-full bg-slate-950 text-sm font-semibold whitespace-nowrap text-white">Compliance casework</Link>}
          {["SUPER", "SECURITY"].includes(user.adminRole) && <Link href="/admin/privacy" className="px-5 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold whitespace-nowrap">Privacy requests</Link>}
          {user.adminRole === "SUPER" && <Link href="/admin/legal" className="px-5 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold whitespace-nowrap">Legal and trust controls</Link>}
        </div>
        {msg && <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-2 text-sm">{msg}</div>}

        {tab==="merchants" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Merchants • {list.length}</h3>
            <div className="mt-4 space-y-3">
              {list.map((m:any)=>(
                <div key={m.id} className="flex flex-col md:flex-row gap-4 border border-slate-200 rounded-xl p-4">
                  {m.imageUrl ? <img src={m.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover" /> : <div aria-hidden="true" className="h-16 w-16 shrink-0 rounded-xl bg-slate-100" />}
                  <div className="flex-1">
                    <div className="font-bold">{m.businessName} <span className="text-xs bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{m.category} • {m.area}</span></div>
                    <div className="text-xs text-slate-500">{m.address} • {m.phone} • Owner: {m.owner.name}</div>
                    <div className="mt-1 flex gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${m.status==="APPROVED"?"bg-emerald-50 text-emerald-700 border-emerald-200": m.status==="PENDING"?"bg-amber-50 text-amber-700 border-amber-200":"bg-red-50 text-red-700 border-red-200"}`}>{m.status}</span>
                      <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded-full">{m.verificationStatus}</span>
                      <span className="text-xs text-slate-500">{m.products?.length||0} products</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={()=>act(m.id,"approve")} className="px-4 py-2 rounded-full bg-emerald-600 text-white text-sm font-semibold">Approve</button>
                    <button onClick={()=>act(m.id,"reject")} className="px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold">Reject</button>
                    <button onClick={()=>act(m.id,"suspend")} className="px-4 py-2 rounded-full bg-red-50 text-red-700 border border-red-200 text-sm font-semibold">Suspend</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="reservations" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Recent reservations</h3>
            <div className="mt-3 space-y-2">
              {reservations.map((r:any)=>(
                <div key={r.id} className="flex justify-between text-sm border-b border-slate-100 py-2">
                  <span>{r.code} • {r.product.name} ×{r.quantity} • {r.consumer.name} → {r.merchant.businessName} • {r.status}</span>
                  <span className="font-bold">{formatNaira(r.totalAmount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==="reports" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Customer reports • {reports.length}</h3>
            {reports.length===0 ? <div className="text-sm text-slate-500 mt-2">No reports.</div> : (
              <div className="mt-3 space-y-2">
                {reports.map((rp:any)=>(
                  <div key={rp.id} className="border border-slate-200 rounded-xl p-3 text-sm">
                    <div className="font-semibold">{rp.category} • {rp.merchant.businessName} • by {rp.reporter.name}</div>
                    <div className="text-slate-600">{rp.description}</div>
                    <div className="text-xs text-slate-400">{new Date(rp.createdAt).toLocaleString()} • {rp.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab==="users" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Users</h3>
            <div className="mt-3 space-y-2">
              {users.map((u:any)=>(
                <div key={u.id} className="flex justify-between text-sm border-b border-slate-100 py-2">
                  <span>{u.name} • {u.email} • {u.phone} • {u.role} {u.isAdmin?"• ADMIN":""}</span>
                  <span className="text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==="audit" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Audit log</h3>
            <div className="mt-3 space-y-2">
              {audit.map((a:any)=>(
                <div key={a.id} className="text-sm border-b border-slate-100 py-2">
                  <b>{a.action}</b> • {a.resourceType} {a.resourceId} • {new Date(a.createdAt).toLocaleString()}
                </div>
              ))}
              {audit.length===0 && <div className="text-sm text-slate-500">No audit entries yet.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
