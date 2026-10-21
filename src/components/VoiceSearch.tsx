"use client";
import { useState, useRef } from "react";
import { Mic, MicOff, Camera, Barcode } from "lucide-react";

export function VoiceSearch({ onResult }: { onResult: (text:string)=>void }){
  const [listening,setListening]=useState(false);
  const [error,setError]=useState("");
  const [draft,setDraft]=useState("");
  const recognitionRef=useRef<any>(null);

  const start=()=>{
    const w:any=window;
    const SR=w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){ setError("Voice isn't supported in this browser — typing works fully."); return; }
    const rec=new SR();
    rec.lang="en-NG"; // language layer: add ha-NG/yo-NG/ig-NG when provider support is verified
    rec.onstart=()=>{ setListening(true); setError(""); setDraft(""); };
    rec.onend=()=> setListening(false);
    rec.onresult=(e:any)=>{ const t=e.results[0][0].transcript; setDraft(t); };
    rec.onerror=(e:any)=>{ setError("Couldn't hear that ("+e.error+"). Check mic permission or type instead."); setListening(false); };
    recognitionRef.current=rec;
    rec.start();
  };
  const stop=()=>{ recognitionRef.current?.stop(); setListening(false); };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" aria-label={listening?"Stop voice search":"Start voice search"} onClick={listening? stop: start} className={`w-9 h-9 rounded-full grid place-items-center border ${listening?"bg-red-500 text-white border-red-500 animate-pulse":"bg-white border-slate-200"}`} title="Voice search (mic only runs after tap)">
        {listening ? <MicOff className="w-4 h-4"/> : <Mic className="w-4 h-4"/>}
      </button>
      {listening && <span className="text-xs text-red-600 font-medium" role="status">● Listening…</span>}
      {draft && (
        <span className="flex items-center gap-1 bg-white border border-slate-200 rounded-full px-2 py-1">
          <input value={draft} onChange={e=>setDraft(e.target.value)} aria-label="Edit recognized text" className="w-36 bg-transparent outline-none text-xs"/>
          <button type="button" onClick={()=>onResult(draft)} className="px-2 py-1 rounded-full bg-live-black text-white text-[11px]">Search</button>
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function CameraCapture({ onFile }: { onFile: (file: File)=>void }){
  const inputRef=useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" aria-label="Search by photo" onClick={()=>inputRef.current?.click()} className="w-9 h-9 rounded-full bg-white border border-slate-200 grid place-items-center" title="Photo search — results are candidates, not exact matches"><Camera className="w-4 h-4"/></button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=> e.target.files?.[0] && onFile(e.target.files[0])} />
    </>
  );
}

export function BarcodeInput({ onScan }: { onScan: (code:string)=>void }){
  const [code,setCode]=useState("");
  const [open,setOpen]=useState(false);
  const [note,setNote]=useState("");
  const videoRef=useRef<HTMLVideoElement>(null);

  const scanWithCamera=async()=>{
    const w:any=window;
    if(!("BarcodeDetector" in w) || !navigator.mediaDevices?.getUserMedia){
      setNote("Camera barcode scanning isn't supported here — type the barcode instead.");
      return;
    }
    try {
      const stream=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }});
      const video=videoRef.current!;
      video.srcObject=stream; await video.play();
      const detector=new w.BarcodeDetector({ formats:["ean_13","ean_8","upc_a","qr_code","code_128"] });
      setNote("Point the camera at the barcode…");
      const tick=async()=>{
        try {
          const codes=await detector.detect(video);
          if(codes?.length){
            const value=codes[0].rawValue;
            stream.getTracks().forEach((t:any)=>t.stop());
            setCode(value); onScan(value); setOpen(false);
            return;
          }
        } catch {}
        requestAnimationFrame(tick);
      };
      tick();
    } catch { setNote("Camera permission denied. Type the barcode instead."); }
  };

  if(!open) return <button type="button" aria-label="Find by barcode" onClick={()=>setOpen(true)} className="w-9 h-9 rounded-full bg-white border border-slate-200 grid place-items-center" title="Barcode lookup (does not by itself prove local stock)"><Barcode className="w-4 h-4"/></button>;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1 bg-white border border-slate-200 rounded-full px-2 py-1">
        <input value={code} onChange={e=>setCode(e.target.value)} placeholder="Barcode e.g. 6034001002003" aria-label="Barcode" className="w-32 bg-transparent outline-none text-xs" />
        <button type="button" onClick={()=>{ onScan(code); setOpen(false); }} className="px-3 py-1 rounded-full bg-live-black text-white text-xs">Find</button>
        <button type="button" onClick={scanWithCamera} className="px-2 py-1 rounded-full bg-slate-100 text-xs">📷 Scan</button>
      </span>
      <video ref={videoRef} className="w-40 h-28 rounded-xl bg-black object-cover" playsInline muted />
      {note && <span className="text-[11px] text-slate-600">{note}</span>}
    </span>
  );
}
