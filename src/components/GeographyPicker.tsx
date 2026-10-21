"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import { DEFAULT_MARKET_CODE, getMarketConfiguration } from "@/lib/market-config";

export type GeographyOption = {
  code: string;
  name: string;
  type: string;
  parentCode: string | null;
  countryCode: string;
  adminLevel: number;
  path: string;
};

type Props = {
  initialCode?: string | null;
  countryCode?: string;
  userId?: string;
  persistPreference?: boolean;
  fieldName?: string;
  compact?: boolean;
  emptyLabel?: string;
  className?: string;
  onSelectionChange?: (value: GeographyOption | null) => void;
};

const typeLabel: Record<string, string> = {
  COUNTRY: "Country",
  STATE: "State",
  TERRITORY: "Federal territory",
  LGA: "LGA",
  AREA_COUNCIL: "FCT area council",
  CITY: "City",
  LOCALITY: "Locality",
  WARD: "Ward",
};

function storageKey(countryCode: string, userId?: string) {
  return `live_location_${countryCode.toLowerCase()}_${userId || "guest"}`;
}

async function fetchLocation(code: string, countryCode: string, signal?: AbortSignal): Promise<GeographyOption | null> {
  const response = await fetch(`/api/geography?code=${encodeURIComponent(code)}&countryCode=${encodeURIComponent(countryCode)}`, { cache: "no-store", signal });
  if (!response.ok) return null;
  const data = await response.json();
  return data.location || null;
}

export default function GeographyPicker({
  initialCode,
  countryCode = DEFAULT_MARKET_CODE,
  userId,
  persistPreference = false,
  fieldName,
  compact = false,
  emptyLabel,
  className = "",
  onSelectionChange,
}: Props) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onSelectionChange);
  const [selected, setSelected] = useState<GeographyOption | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeographyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { onChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  useEffect(() => {
    if (!persistPreference) return;
    const onLocationChange = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string | null; countryCode?: string }>).detail;
      if (detail?.countryCode && detail.countryCode !== countryCode) return;
      if (!detail?.code) {
        setSelected(null);
        onChangeRef.current?.(null);
        return;
      }
      void fetchLocation(detail.code, countryCode).then((location) => {
        if (!location) return;
        setSelected(location);
        onChangeRef.current?.(location);
      }).catch(() => { /* another picker may update independently */ });
    };
    window.addEventListener("live:location-change", onLocationChange);
    return () => window.removeEventListener("live:location-change", onLocationChange);
  }, [persistPreference, countryCode]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function loadInitial() {
      let code = initialCode || "";
      if (!code && persistPreference) {
        try {
          const saved = localStorage.getItem(storageKey(countryCode, userId));
          if (saved) code = JSON.parse(saved)?.code || "";
        } catch { /* device preference is optional */ }
      }
      if (!code) {
        setSelected(null);
        onChangeRef.current?.(null);
        return;
      }
      const location = await fetchLocation(code, countryCode, controller.signal).catch(() => null);
      if (!cancelled) {
        setSelected(location);
        onChangeRef.current?.(location);
        if (!location && initialCode) setNotice("Your saved location is no longer available. Choose another location or clear it.");
      }
    }
    void loadInitial();
    return () => { cancelled = true; controller.abort(); };
  }, [initialCode, persistPreference, userId, countryCode]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => searchRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ countryCode, limit: query.trim() ? "40" : "50" });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/geography?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Location search is unavailable right now.");
        const data = await response.json();
        setResults(data.locations || []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Location search is unavailable right now.");
        setResults([]);
      } finally { setLoading(false); }
    }, query.trim() ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, countryCode]);

  const select = async (location: GeographyOption | null) => {
    setSelected(location);
    setNotice("");
    setError("");
    onChangeRef.current?.(location);
    setOpen(false);

    if (!persistPreference) return;
    try {
      if (location) localStorage.setItem(storageKey(countryCode, userId), JSON.stringify({ code: location.code, name: location.name, type: location.type, countryCode }));
      else localStorage.removeItem(storageKey(countryCode, userId));
    } catch {
      setNotice("Location is selected for this view, but this browser could not save the device preference.");
    }
    if (location) document.cookie = `live_location_code=${encodeURIComponent(location.code)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    else document.cookie = "live_location_code=; Path=/; Max-Age=0; SameSite=Lax";

    window.dispatchEvent(new CustomEvent("live:location-change", { detail: { code: location?.code || null, name: location?.name || `All ${getMarketConfiguration(countryCode)?.countryName || "selected market"}`, type: location?.type || "COUNTRY", countryCode } }));

    if (userId) {
      try {
        const response = await fetch("/api/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferredLocationCode: location?.code || null }),
        });
        if (!response.ok) setNotice("Location saved on this device; account preference sync failed.");
      } catch {
        setNotice("Location saved on this device; account preference sync failed.");
      }
    }
  };

  const marketName = getMarketConfiguration(countryCode)?.countryName || "selected market";
  const buttonText = selected?.name || emptyLabel || `All ${marketName}`;
  const dialogTitleId = `geo-dialog-title-${reactId}`;
  const searchId = `geo-search-${reactId}`;

  return <>
    {fieldName && <input type="hidden" name={fieldName} value={selected?.code || ""} />}
    <button
      type="button"
      className={`live-geo-trigger ${compact ? "live-geo-trigger-compact" : ""} ${className}`.trim()}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => { setError(""); setQuery(""); setOpen(true); }}
    >
      <MapPin size={16} aria-hidden="true" />
      <span className="live-geo-trigger-copy">{buttonText}</span>
      <span className="sr-only">Change search location</span>
    </button>
    {notice && <span className="live-geo-notice" role="status">{notice}</span>}

    <dialog
      ref={dialogRef}
      className="live-geo-dialog"
      aria-labelledby={dialogTitleId}
      onCancel={(event) => { event.preventDefault(); setOpen(false); }}
      onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === dialogRef.current) setOpen(false); }}
    >
      <div className="live-geo-dialog-inner">
        <div className="live-geo-dialog-head">
          <div>
            <p className="live-eyebrow">Manual location · no GPS required</p>
            <h2 id={dialogTitleId}>Choose a location in {marketName}</h2>
            <p>Location support does not mean merchants or stock are available there.</p>
          </div>
          <button type="button" className="live-icon-button" aria-label="Close location selector" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <label className="live-geo-search" htmlFor={searchId}>
          <Search size={18} aria-hidden="true" />
          <input ref={searchRef} id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search administrative areas, cities, or localities…" autoComplete="off" />
          {loading && <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />}
        </label>
        <button type="button" className="live-geo-result live-geo-nationwide" onClick={() => void select(null)}>
          <span><strong>All {marketName}</strong><small>Nationwide search · no GPS used</small></span>
          {!selected && <span className="live-geo-selected-label">Selected</span>}
        </button>
        {error && <p className="live-geo-error" role="alert">{error}</p>}
        {!error && !query.trim() && <p className="live-geo-results-label">Available administrative areas</p>}
        {!error && query.trim().length === 1 && <p className="live-geo-results-label">Type at least two letters to search locations.</p>}
        {!error && query.trim().length !== 1 && results.length > 0 && <ul className="live-geo-results" aria-label="Matching locations">
          {results.map((location) => <li key={location.code}>
            <button type="button" className="live-geo-result" onClick={() => void select(location)}>
              <span><strong>{location.name}</strong><small>{typeLabel[location.type] || location.type} · {location.path}</small></span>
              {selected?.code === location.code && <span className="live-geo-selected-label">Selected</span>}
            </button>
          </li>)}
        </ul>}
        {!error && !loading && query.trim().length >= 2 && results.length === 0 && <div className="live-geo-empty"><strong>No matching geography record</strong><span>Try another administrative area, city, locality, or spelling.</span></div>}
        <p className="live-geo-footnote">Location names are sourced from the published geography dataset. Listings, prices, stock and fulfilment are shown only when real merchant records support them.</p>
      </div>
    </dialog>
  </>;
}
