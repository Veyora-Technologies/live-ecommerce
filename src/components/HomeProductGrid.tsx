"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";

type Product = Record<string, any>;

export default function HomeProductGrid({
  initialProducts,
  initialLocationCode = "",
  initialLocationName = "",
  userId,
}: {
  initialProducts: Product[];
  initialLocationCode?: string;
  initialLocationName?: string;
  userId?: string;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [locationCode, setLocationCode] = useState(initialLocationCode);
  const [locationName, setLocationName] = useState(initialLocationName);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (nextCode: string, signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({ inStock: "true", pageSize: "8", sort: "freshness", scope: nextCode ? "admin" : "nationwide" });
    if (nextCode) params.set("locationCode", nextCode);
    try {
      const response = await fetch(`/api/v1/search?${params.toString()}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Search refresh failed");
      const data = await response.json();
      const eligible = (data.results || []).filter((product: Product) => (product.reservableQuantity ?? 0) > 0);
      setProducts(eligible);
      setMessage("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Couldn't refresh this scope. The listings above may be older; check their confirmation times before travelling.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let savedCode = initialLocationCode;
    let savedName = initialLocationName;
    if (!savedCode) {
      try {
        const saved = localStorage.getItem(`live_location_ng_${userId || "guest"}`) || "";
        const parsed = saved ? JSON.parse(saved) : null;
        if (parsed?.code) { savedCode = parsed.code; savedName = parsed.name || ""; }
      } catch { /* local preferences are optional */ }
    }
    setLocationCode(savedCode);
    setLocationName(savedName);
    const controller = new AbortController();
    void load(savedCode, controller.signal);
    const onLocation = (event: Event) => {
      const value = (event as CustomEvent<{ code?: string | null; name?: string }>).detail;
      const code = value?.code || "";
      setLocationCode(code);
      setLocationName(value?.name || "All Nigeria");
      void load(code);
    };
    window.addEventListener("live:location-change", onLocation);
    return () => { controller.abort(); window.removeEventListener("live:location-change", onLocation); };
  }, [initialLocationCode, initialLocationName, load, userId]);

  const scopeLabel = locationName || "All Nigeria";
  const browseHref = locationCode ? `/search?scope=admin&locationCode=${encodeURIComponent(locationCode)}` : "/search?scope=nationwide";

  return <>
    <div className="live-section-toolbar">
      <p className="live-muted">Scope: {scopeLabel} · merchant-reported listings · stock is rechecked when a reservation is submitted.</p>
      {loading && <span className="live-refresh-indicator" role="status"><LoaderCircle size={14} className="animate-spin" /> Updating</span>}
    </div>
    {message && <div className="live-inline-notice" role="status"><span>{message}</span><button type="button" onClick={() => void load(locationCode)}><RotateCw size={15} /> Retry</button></div>}
    {products.length ? <div className="live-product-grid">{products.map((product) => <ProductCard key={product.id} p={product} />)}</div> : loading ? <div className="live-product-grid" aria-label="Loading listings">{Array.from({ length: 4 }, (_, i) => <div key={i} className="live-product-skeleton"><div className="live-skeleton" /><div className="live-skeleton" /><div className="live-skeleton" /></div>)}</div> : <div className="live-empty-card"><strong>{locationCode ? `No reservable listings currently recorded for ${scopeLabel}` : "No reservable listings recorded across Nigeria right now"}</strong><p>Change to a broader scope or search for an item. No coverage or stock has been assumed.</p><a className="live-button" href={browseHref}>Search this scope</a></div>}
  </>;
}
