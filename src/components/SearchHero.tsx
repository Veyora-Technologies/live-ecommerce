"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { VoiceSearch, CameraCapture, BarcodeInput } from "./VoiceSearch";

export default function SearchHero() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const go = (term: string) => { if (term.trim()) router.push(`/search?q=${encodeURIComponent(term.trim())}`); };

  const handleCamera = async (file: File) => {
    setBusy(true);
    setStatus("Checking image format…");
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/v1/image", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      setStatus(data.message || data.error || "Visual product search is unavailable. Text search still works.");
    } catch {
      setStatus("Couldn't reach Furnivo. Your image was not saved; try text or barcode search.");
    } finally {
      setBusy(false);
    }
  };

  const handleBarcode = async (code: string) => {
    if (!code.trim()) return;
    setBusy(true);
    setStatus("Checking the local product catalogue…");
    try {
      const response = await fetch(`/api/products/barcode/${encodeURIComponent(code.trim())}`);
      const data = await response.json().catch(() => null);
      if (data?.found && data.products?.[0]?.name) go(data.products[0].name);
      else setStatus(data?.error || `No local catalogue match for ${code}. A barcode alone does not prove nearby stock.`);
    } catch {
      setStatus("Barcode lookup is unavailable while offline. Type the product name instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="live-search-hero-wrap">
      <form onSubmit={(event) => { event.preventDefault(); go(q); }} className="live-search-hero" role="search">
        <Search size={21} aria-hidden="true" />
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search products, services or stores" aria-label="Search for real availability" />
        <div className="live-search-tools">
          <VoiceSearch onResult={(text) => { setQ(text); go(text); }} />
          <CameraCapture onFile={handleCamera} />
          <BarcodeInput onScan={handleBarcode} />
        </div>
        <button type="submit" className="live-button live-button-primary" disabled={busy}>Search</button>
      </form>
      {status && <p className="live-search-feedback" role="status" aria-live="polite">{status}</p>}
      <p className="live-search-note">Availability is merchant-reported and can change. Every reservation is revalidated on the server.</p>
    </div>
  );
}
