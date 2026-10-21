"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { VoiceSearch, CameraCapture, BarcodeInput } from "@/components/VoiceSearch";

/** Voice / camera / barcode entry points for the search page. All optional; text always works. */
export default function SearchTools(){
  const router = useRouter();
  const [msg,setMsg] = useState("");
  const go=(t:string)=> router.push(`/search?q=${encodeURIComponent(t)}`);

  const onCamera = async(file: File)=>{
    setMsg("Uploading photo for candidate matching…");
    const fd = new FormData(); fd.append("image", file);
    const res = await fetch("/api/v1/image",{ method:"POST", body: fd });
    const data = await res.json().catch(()=>null);
    if(!data){ setMsg("Image search unavailable — please use text search."); return; }
    if(data.candidates?.length) go(data.candidates[0].name);
    else setMsg(data.message || "No visual candidates. Please type the product name above.");
  };
  const onBarcode = async(code:string)=>{
    if(!code.trim()) return;
    const res = await fetch(`/api/products/barcode/${encodeURIComponent(code.trim())}`);
    const data = await res.json().catch(()=>null);
    if(data?.found) go(data.products[0].name);
    else setMsg(`Barcode ${code} is not listed locally yet. A matching barcode alone does not prove local stock — try the product name.`);
  };

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">Speak, snap or scan</div>
      <div className="mt-2 flex items-center gap-2">
        <VoiceSearch onResult={go} />
        <CameraCapture onFile={onCamera} />
        <BarcodeInput onScan={onBarcode} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Microphone is only active after you tap it, and the transcript appears as editable text. Camera results are candidates, not guaranteed exact matches. No voice is secretly recorded.</p>
      {msg && <p className="mt-1 text-[11px] text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1">{msg}</p>}
    </div>
  );
}
