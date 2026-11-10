"use client";

import { useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import GeographyPicker from "@/components/GeographyPicker";
import { DEFAULT_MARKET_CODE, getActiveMarkets, getMarketConfiguration } from "@/lib/market-config";

export type SearchScope = "nationwide" | "admin" | "locality" | "multi" | "nearby";

type Props = { initialCodes?: string[]; initialScope?: SearchScope; countryCode?: string };

export default function SearchLocationScope({ initialCodes = [], initialScope = "nationwide", countryCode = DEFAULT_MARKET_CODE }: Props) {
  const [marketCode, setMarketCode] = useState(countryCode);
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const [codes, setCodes] = useState<string[]>(() => initialCodes.length ? initialCodes.slice(0, 10) : [""]);
  const rows = scope === "multi" ? Math.max(2, codes.length) : 1;

  const updateCode = (index: number, code: string) => setCodes((current) => {
    const next = [...current];
    next[index] = code;
    return next;
  });

  const addLocation = () => setCodes((current) => current.length >= 10 ? current : [...current, ""]);
  const removeLocation = (index: number) => setCodes((current) => current.filter((_, itemIndex) => itemIndex !== index));
  const markets = getActiveMarkets();
  const marketName = getMarketConfiguration(marketCode)?.countryName || "selected market";

  return <div className="live-search-location-scope">
    <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="countryCode">Market</label>
    <select
      id="countryCode"
      name="countryCode"
      value={marketCode}
      onChange={(event) => { setMarketCode(event.target.value); setCodes([""]); setScope("nationwide"); }}
      className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200"
    >
      {markets.map((market) => <option key={market.countryCode} value={market.countryCode}>{market.countryName}</option>)}
    </select>
    {markets.length === 1 && <p className="live-scope-explainer">Only {marketName} is currently enabled. Search selection does not activate another market.</p>}

    <label className="mt-3 block text-xs font-semibold uppercase text-slate-500" htmlFor="locationScope">Search location scope</label>
    <select
      id="locationScope"
      name="scope"
      value={scope}
      onChange={(event) => setScope(event.target.value as SearchScope)}
      className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200"
    >
      <option value="nationwide">Nationwide · all {marketName}</option>
      <option value="admin">Selected area + its contained locations</option>
      <option value="locality">Exact LGA / city / locality only</option>
      <option value="multi">Multiple selected locations</option>
      <option value="nearby" disabled>Nearby · not available without verified location data</option>
    </select>

    {scope === "nationwide" && <p className="live-scope-explainer">Search records within {marketName}. This is not a claim that every area has listings.</p>}
    {scope === "nearby" && <p className="live-scope-explainer" role="status">Nearby search is not available. Furnivo does not have sufficiently verified, consented location and routing data. Use a selected area or nationwide scope.</p>}

    {(scope === "admin" || scope === "locality") && <div className="live-scope-location-control">
      <GeographyPicker countryCode={marketCode} fieldName="locationCode" initialCode={codes[0] || null} emptyLabel={`Select an area in ${marketName}`} onSelectionChange={(location) => updateCode(0, location?.code || "")} />
      <p className="live-scope-explainer">{scope === "admin" ? "Includes this area and known child locations. State/FCT scopes include their LGAs or area councils." : "Matches the selected LGA, city or locality only; children are not included."}</p>
    </div>}

    {scope === "multi" && <div className="live-scope-multiple">
      <p className="live-scope-explainer">Choose 2–10 locations. Results are the union of these areas and their known descendants. Select no more than needed.</p>
      {Array.from({ length: rows }, (_, index) => <div className="live-scope-multi-row" key={index}>
        <GeographyPicker countryCode={marketCode} fieldName="locationCode" initialCode={codes[index] || null} emptyLabel={`Select location ${index + 1}`} onSelectionChange={(location) => updateCode(index, location?.code || "")} />
        {rows > 2 && <button type="button" className="live-icon-button" aria-label={`Remove location ${index + 1}`} onClick={() => removeLocation(index)}><Trash2 size={16} /></button>}
      </div>)}
      {rows < 10 && <button type="button" className="live-scope-add" onClick={addLocation}><Plus size={15} /> Add another location</button>}
    </div>}

    <div className="live-scope-changed"><MapPin size={13} aria-hidden="true" /><span>Location scope is explicit and can be changed or cleared at any time.</span></div>
  </div>;
}
