"use client";
import { FormEvent, useState } from "react";
import { Sparkles, Send, X } from "lucide-react";

export default function AssistWidget(){
  const [open,setOpen]=useState(false);
  const [msg,setMsg]=useState("");
  const [history,setHistory]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);

  const send=async(e?:FormEvent)=>{
    e?.preventDefault();
    if(!msg.trim()||loading) return;
    const message=msg.trim();
    setMsg("");
    setHistory(h=>[...h,{role:"user", text:message}]);
    setLoading(true);
    try {
      const res=await fetch("/api/assist",{ method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ message }), cache:"no-store"});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Live Assist could not complete that request.");
      setHistory(h=>[...h,{role:"assistant", text:data.reply || "No response was returned.", tools:data.toolsUsed}]);
    } catch(error) {
      setHistory(h=>[...h,{role:"assistant", text:error instanceof Error ? error.message : "Connection failed. Try Search or My Live; no reservation or other change was made."}]);
    } finally { setLoading(false); }
  };

  return (
    <>
      <button type="button" aria-label={open ? "Close Live Assist" : "Open Live Assist"} aria-expanded={open} aria-controls="live-assist-panel" onClick={()=>setOpen(!open)} className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-4 lg:bottom-6 lg:right-6 w-14 h-14 rounded-full bg-live-black text-white shadow-xl grid place-items-center live-assist-trigger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
        {open ? <X className="w-6 h-6" aria-hidden="true"/> : <Sparkles className="w-6 h-6" aria-hidden="true"/>}
      </button>
      {open && (
        <section id="live-assist-panel" aria-label="Live Assist" className="fixed bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] right-4 lg:bottom-20 lg:right-6 w-[min(92vw,380px)] h-[min(72dvh,480px)] bg-white border border-slate-300 rounded-[24px] shadow-2xl flex flex-col live-assist-panel overflow-hidden">
          <header className="bg-live-black text-white p-4">
            <div className="font-black flex items-center gap-2"><Sparkles className="w-4 h-4 text-emerald-400" aria-hidden="true"/> Live Assist</div>
            <div className="text-xs text-white/80">Search approved listings, compare similar names, or check your reservations. No location access.</div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {["Find paracetamol in Wuse","Compare rice prices","Track my order","What is low in my shop?"].map(q=>(
                <button type="button" key={q} onClick={()=>setMsg(q)} className="text-[11px] bg-white/10 border border-white/20 rounded-full px-2 py-1 whitespace-nowrap min-h-8">{q}</button>
              ))}
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 space-y-3" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Assist conversation">
            {history.length===0 && <div className="text-sm text-slate-700">Try: “Find rice under ₦10,000 in Wuse” or “Show pharmacies open now in Garki”. Live Assist does not place reservations; use the product page to review and submit one.</div>}
            {history.map((h,i)=>(
              <div key={i} className={`p-3 rounded-2xl text-sm whitespace-pre-wrap break-words ${h.role==="user"?"bg-slate-900 text-white ml-6":"bg-slate-100 text-slate-900 mr-6"}`}>
                {h.text}
                {h.tools?.length>0 && <div className="mt-2 text-xs text-slate-600">Data actions: {h.tools.join(", ")}</div>}
              </div>
            ))}
            {loading && <div className="text-sm text-slate-700" role="status">Checking Live data…</div>}
          </div>
          <form onSubmit={send} className="p-3 border-t border-slate-200 flex gap-2">
            <label htmlFor="assist-message" className="sr-only">Message Live Assist</label>
            <input id="assist-message" value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Ask Live Assist…" className="min-w-0 flex-1 h-11 px-4 rounded-full border border-slate-300 text-sm" />
            <button type="submit" aria-label="Send message" disabled={loading||!msg.trim()} className="w-11 h-11 shrink-0 rounded-full bg-live-black text-white grid place-items-center disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><Send className="w-4 h-4" aria-hidden="true"/></button>
          </form>
          <div className="px-4 pb-3 text-xs text-slate-600">Prices and availability are merchant-reported. Similar names may differ. This assistant does not book or contact merchants.</div>
        </section>
      )}
    </>
  );
}
