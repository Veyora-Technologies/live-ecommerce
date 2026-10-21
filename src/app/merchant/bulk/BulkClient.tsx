"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { merchantLocationLabel } from "@/lib/location-label";
import Papa from "papaparse";

const SAMPLE = `name,category,brand,price,currency,stockQuantity,unit,sku,barcode
Paracetamol 500mg (Emzor) x20,Pharmacy,Emzor,1200,NGN,40,pack,PARA-500,6034001002003
Peak Milk Powder 400g,Grocery,Peak,3200,NGN,25,tin,PEAK-400,6034001002010`;

export default function BulkClient({ merchantId, canEdit = true }: { merchantId:string; canEdit?:boolean }){
  const [rows,setRows]=useState<any[]>([]);
  const [mode,setMode]=useState("upsert");
  const [result,setResult]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [barcodeMsg,setBarcodeMsg]=useState("");
  const [lookup,setLookup]=useState("");
  const [branches,setBranches]=useState<any[]>([]);
  const [branchId,setBranchId]=useState("");
  const [loadingBranches,setLoadingBranches]=useState(true);
  const [branchError,setBranchError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/merchant/branches?merchantId=${encodeURIComponent(merchantId)}`,{cache:"no-store",signal:controller.signal})
      .then(async res=>{const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||"Could not load branches."); setBranches(data.branches||[]);})
      .catch(error=>{if(!(error instanceof DOMException&&error.name==="AbortError")) setBranchError(error instanceof Error?error.message:"Could not load branches.");})
      .finally(()=>setLoadingBranches(false));
    return ()=>controller.abort();
  },[merchantId]);

  const parse=(text:string)=>{
    const out=Papa.parse(text.trim(),{ header:true, skipEmptyLines:true });
    if(out.errors.length) setErr(out.errors[0].message); else setErr("");
    setRows((out.data as any[]).filter((r:any)=> r.name));
    setResult(null);
  };
  const onFile=(f:File)=>{ f.text().then(parse).catch(()=>setErr("Could not read this CSV file. Choose a local text/CSV file and try again.")); };

  const run=async()=>{
    if(!branchId){ setErr("Select the branch that owns these stock rows. No inventory was submitted."); return; }
    if(!navigator.onLine){ setErr("CSV import requires a connection. No rows were submitted or stored locally."); return; }
    setBusy(true); setErr("");
    try {
      const res=await fetch("/api/merchant/products/bulk",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ merchantId, branchId, rows, mode })});
      const data=await res.json().catch(()=>({}));
      if(res.ok) setResult(data); else setErr(data.error||"Import failed; no successful result was returned.");
    } catch { setErr("Connection failed. The CSV remains in this page; no successful import is confirmed."); }
    finally { setBusy(false); }
  };

  const doLookup=async()=>{
    if(!lookup.trim()) return;
    setBarcodeMsg("Looking in the Live catalogue…");
    try {
      const res=await fetch(`/api/products/barcode/${encodeURIComponent(lookup.trim())}`, { cache:"no-store" });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Barcode lookup failed.");
      setBarcodeMsg(data.found? `Found: ${data.products.map((p:any)=>`${p.name} at ${p.merchant} (${p.availability})`).join(" • ")}` : "No listing carries that barcode yet — add it in your CSV (barcode column). A barcode match never proves another shop's live stock.");
    } catch(error) { setBarcodeMsg(error instanceof Error ? error.message : "Barcode lookup is unavailable."); }
  };

  return (
    <div className="mt-6 grid lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold">1. Choose a stock branch</h3>
        <label className="sr-only" htmlFor="bulk-branch">Branch for this CSV import</label>
        <select id="bulk-branch" value={branchId} onChange={e=>{setBranchId(e.target.value);setResult(null);}} className="mt-3 w-full h-11 px-3 rounded-xl border border-slate-200" disabled={loadingBranches||!!branchError}>
          <option value="">{loadingBranches?"Loading branches…":"Select a branch for this CSV"}</option>
          {branches.map((branch:any)=><option key={branch.id} value={branch.id}>{branch.name} · {merchantLocationLabel(branch)}</option>)}
        </select>
        {branchError && <p className="mt-2 text-sm text-red-700" role="alert">{branchError}</p>}
        {!loadingBranches&&!branchError&&!branches.length&&<p className="mt-2 text-xs text-amber-800">No branch is recorded. <Link className="font-semibold underline" href={`/merchant/connect?merchantId=${encodeURIComponent(merchantId)}`}>Create a branch</Link> before importing inventory.</p>}
        {branchId&&<p className="mt-2 text-xs text-slate-500">Every row in this import is assigned only to the selected branch. Other branches' quantities are unchanged.</p>}
        <h3 className="font-bold mt-5">2. Upload CSV</h3>
        <input type="file" accept=".csv,text/csv" onChange={e=>e.target.files?.[0] && onFile(e.target.files[0])} className="mt-3 block w-full text-sm" aria-label="Upload products CSV"/>
        <p className="text-xs text-slate-500 mt-2">Columns: name, category, brand, price (NGN major units), currency (required per row; currently NGN only), stockQuantity, unit, sku, barcode. Currencyless legacy CSV rows are rejected as ambiguous; no automatic conversion is made.</p>
        <button onClick={()=>parse(SAMPLE)} className="mt-2 text-sm underline font-medium">Try the sample file</button>
        <label className="block mt-4 text-xs font-semibold uppercase text-slate-500">Import mode</label>
        <select value={mode} onChange={e=>setMode(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200">
          <option value="upsert">Update existing (same name+SKU) or create</option>
          <option value="create">Create only — duplicates fail</option>
        </select>
        <h3 className="font-bold mt-5">3. Preview ({rows.length} rows)</h3>
        <div className="mt-2 max-h-56 overflow-auto text-xs">
          {rows.length? rows.map((r,i)=>(<div key={i} className="flex justify-between border-b border-slate-50 py-1"><span>{i+1}. {r.name}</span><span>{r.currency || "currency required"} {r.price} • ×{r.stockQuantity} {r.barcode?`• ${r.barcode}`:""}</span></div>)) : <p className="text-slate-500">No rows yet.</p>}
        </div>
        <button onClick={run} disabled={busy||!rows.length||!canEdit||!branchId} className="mt-4 w-full h-11 rounded-full bg-live-black text-white font-semibold disabled:opacity-40">{busy?"Importing…":"4. Import into selected branch"}</button>
        {!canEdit && <p className="mt-2 text-xs text-slate-500" role="note">Your merchant role is read-only for inventory imports. You may still export the catalogue.</p>}
        {err && <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2">{err}</p>}
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold">Import result</h3>
          {result? (
            <div className="mt-2 text-sm">
              <p><b className="text-emerald-700">{result.success} succeeded</b> • <b className={result.failed?"text-red-700":""}>{result.failed} failed</b> of {result.total}. To undo a bad row, re-import a corrected CSV in “update” mode — history is preserved in inventory movements, never rewritten.</p>
              <div className="mt-2 max-h-64 overflow-auto space-y-1">{result.results.map((r:any)=>(<div key={r.row} className={`rounded-lg px-3 py-1.5 text-xs ${r.status==="failed"?"bg-red-50 text-red-800":"bg-emerald-50 text-emerald-800"}`}>Row {r.row}: {r.status}{r.error?` — ${r.error}`:""}</div>))}</div>
            </div>
          ) : <p className="text-sm text-slate-500 mt-1">Results appear here row-by-row. Sync failures are always visible.</p>}
          {branchId ? <a href={`/api/merchant/products/bulk?merchantId=${encodeURIComponent(merchantId)}&branchId=${encodeURIComponent(branchId)}`} className="mt-4 inline-grid h-10 px-6 place-items-center rounded-full bg-white border border-slate-300 text-sm font-semibold">⬇ Export selected branch catalogue</a> : <button type="button" disabled className="mt-4 inline-grid h-10 px-6 place-items-center rounded-full bg-white border border-slate-300 text-sm font-semibold opacity-50">Select a branch to export</button>}
        </div>

        <div className="bg-live-black text-white rounded-2xl p-5">
          <h3 className="font-bold">Barcode lookup for stock entry</h3>
          <p className="text-xs text-white/60 mt-1">Scan/type a barcode to pre-fill from an existing listing. Not every product has a barcode; manual entry always works.</p>
          <div className="flex gap-2 mt-3">
            <input value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="6034001002003" className="flex-1 h-11 px-3 rounded-xl text-slate-900"/>
            <button onClick={doLookup} className="h-11 px-5 rounded-full bg-live-green-ink text-white font-semibold">Look up</button>
          </div>
          {barcodeMsg && <p className="mt-2 text-sm text-white/80">{barcodeMsg}</p>}
        </div>
      </div>
    </div>
  );
}
