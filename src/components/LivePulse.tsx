"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play, RefreshCw, Sparkles } from "lucide-react";
import { formatNaira } from "@/lib/utils";
import ImageWithFallback from "@/components/ImageWithFallback";

type PulseUpdate = {
  id: string; productId: string; name: string; category: string; price: number; availability: string;
  reservableQuantity: number; imageUrl?: string | null; merchant: string; area: string;
  previousStatus?: string | null; newStatus?: string | null; changeSource: string; confirmedAt: string;
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " WAT";
}

export default function LivePulse({ initialUpdates, initialLocationCode = "", initialLocationName = "", userId }: { initialUpdates: PulseUpdate[]; initialLocationCode?: string; initialLocationName?: string; userId?: string }) {
  const [updates, setUpdates] = useState(initialUpdates);
  const [pending, setPending] = useState<PulseUpdate[]>([]);
  const [locationCode, setLocationCode] = useState(initialLocationCode);
  const [locationName, setLocationName] = useState(initialLocationName);
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState("");
  const known = useRef(new Map(initialUpdates.map((item) => [item.id, item.confirmedAt])));
  const initializedArea = useRef<string | null>(null);

  const refresh = useCallback(async (selectedLocationCode: string, initial = false, signal?: AbortSignal) => {
    setRefreshing(true);
    const params = new URLSearchParams({ scope: selectedLocationCode ? "admin" : "nationwide" });
    if (selectedLocationCode) params.set("locationCode", selectedLocationCode);
    try {
      const response = await fetch(`/api/v1/pulse${params.size ? `?${params}` : ""}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Pulse is unavailable");
      const data = await response.json();
      const incoming = (data.updates || []) as PulseUpdate[];
      setLastSynced(data.asOf || new Date().toISOString());
      setError("");
      if (initial) {
        setUpdates(incoming);
        setPending([]);
        known.current = new Map(incoming.map((item) => [item.id, item.confirmedAt]));
      } else {
        const newRows = incoming.filter((item) => !known.current.has(item.id));
        for (const row of incoming) known.current.set(row.id, row.confirmedAt);
        if (newRows.length) setPending((current) => [...newRows, ...current].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 8));
        setUpdates((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          for (const item of incoming) if (!known.current.has(item.id)) byId.set(item.id, item);
          return [...byId.values()].slice(0, 8);
        });
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("Couldn't refresh merchant updates. The last shown confirmation time is unchanged.");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (!initialLocationCode) {
      try {
        const stored = localStorage.getItem(`live_location_ng_${userId || "guest"}`) || "";
        const parsed = stored ? JSON.parse(stored) : null;
        if (parsed?.code) { setLocationCode(parsed.code); setLocationName(parsed.name || ""); }
      } catch { /* optional preference */ }
    }
    const onLocation = (event: Event) => {
      const value = (event as CustomEvent<{ code?: string | null; name?: string }>).detail;
      setLocationCode(value?.code || "");
      setLocationName(value?.name || "All Nigeria");
    };
    window.addEventListener("live:location-change", onLocation);
    return () => window.removeEventListener("live:location-change", onLocation);
  }, [initialLocationCode, userId]);

  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    const isNewArea = initializedArea.current !== locationCode;
    const run = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void refresh(locationCode, isNewArea, controller.signal);
      initializedArea.current = locationCode;
    };
    run();
    const timer = window.setInterval(run, 60_000);
    const onOnline = () => run();
    window.addEventListener("online", onOnline);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("online", onOnline); };
  }, [locationCode, paused, refresh]);

  const showNew = () => {
    setUpdates((current) => {
      const map = new Map([...pending, ...current].map((item) => [item.id, item]));
      return [...map.values()].slice(0, 8);
    });
    setPending([]);
  };

  return <section className="live-pulse-panel" aria-labelledby="live-pulse-title">
    <div className="live-pulse-head">
      <div>
        <div className="live-eyebrow"><Sparkles size={14} aria-hidden="true" /> Furnivo Pulse · merchant updates</div>
        <h2 id="live-pulse-title" className="live-section-title">Availability, recently confirmed {locationName ? `in ${locationName}` : "across Nigeria"}</h2>
        <p className="live-muted">Updates recorded for approved merchant listings, checked every 60 seconds. This is not proof of physical stock.</p>
      </div>
      <button type="button" className="live-button" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{paused ? "Resume updates" : "Pause updates"}
      </button>
    </div>
    <div className="live-pulse-status" aria-live="polite">
      <span className={`live-status-dot ${paused ? "is-paused" : "is-open"}`} />
      <span>{paused ? "Automatic updates paused" : refreshing ? "Checking for merchant updates…" : "Checking periodically"}</span>
      {lastSynced && <span>Last successful sync: {timeLabel(lastSynced)}</span>}
      {refreshing && <RefreshCw size={14} className="animate-spin" aria-hidden="true" />}
    </div>
    {pending.length > 0 && <div className="live-pulse-new">
      <span>{pending.length} new merchant update{pending.length === 1 ? "" : "s"} available</span>
      <button type="button" className="live-button live-button-primary" onClick={showNew}>Show updates</button>
    </div>}
    {error && <div className="live-inline-notice" role="status"><span>{error}</span><button type="button" onClick={() => void refresh(locationCode, true)}><RefreshCw size={15} /> Retry</button></div>}
    {updates.length ? <div className="live-pulse-grid">
      {updates.map((item) => <article key={item.id} className="live-pulse-card">
        <Link href={`/product/${item.productId}`} className="live-pulse-image-link" aria-label={`View ${item.name}`}>
          <ImageWithFallback src={item.imageUrl} alt={item.imageUrl ? item.name : ""} className="live-pulse-image" />
        </Link>
        <div className="live-pulse-card-copy">
          <div className="live-pulse-card-top"><span className="live-pulse-label">{item.previousStatus && item.previousStatus !== item.newStatus ? `${item.previousStatus.replaceAll("_", " ")} → ${item.newStatus?.replaceAll("_", " ")}` : "Merchant confirmed availability"}</span><span className="live-muted">{timeLabel(item.confirmedAt)}</span></div>
          <Link className="live-pulse-product-name" href={`/product/${item.productId}`}>{item.name}</Link>
          <div className="live-muted">{item.merchant} · {item.area}</div>
          <div className="live-pulse-price-row"><strong>{formatNaira(item.price)}</strong><span>{item.availability === "LOW_STOCK" ? "Low stock reported" : "In stock reported"}</span></div>
        </div>
      </article>)}
    </div> : <div className="live-empty-card"><strong>No recent merchant updates {locationName ? `in ${locationName}` : "in the selected national scope"}</strong><p>Furnivo will show this section when real inventory confirmations are recorded. Search current listings in the meantime.</p><Link className="live-button" href={locationCode ? `/search?scope=admin&locationCode=${encodeURIComponent(locationCode)}` : "/search?scope=nationwide"}>Search this scope</Link></div>}
    <p className="live-pulse-disclaimer">Merchant-reported status can change. We revalidate stock in the reservation transaction; call before a long trip if the confirmation is stale.</p>
  </section>;
}
