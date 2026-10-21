"use client";

import { useEffect, useState } from "react";

type AreaOption = { code: string; name: string; type: string; parentCode: string | null };

export default function MerchantGeographyFields({
  stateCode = "",
  lgaCode = "",
  cityCode = "",
}: {
  stateCode?: string;
  lgaCode?: string;
  cityCode?: string;
}) {
  const [states, setStates] = useState<AreaOption[]>([]);
  const [children, setChildren] = useState<AreaOption[]>([]);
  const [selectedState, setSelectedState] = useState(stateCode);
  const [selectedLga, setSelectedLga] = useState(lgaCode);
  const [selectedCity, setSelectedCity] = useState(cityCode);
  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/geography?limit=50", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Nigeria geography records are not available yet.");
        const data = await response.json();
        setStates((data.locations || []).filter((item: AreaOption) => item.type === "STATE" || item.type === "TERRITORY"));
        setError("");
      })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Could not load locations."); })
      .finally(() => setLoadingStates(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedState) { setChildren([]); return; }
    const controller = new AbortController();
    setLoadingChildren(true);
    fetch(`/api/geography?parentCode=${encodeURIComponent(selectedState)}&limit=50`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load LGAs and area councils for the selected state or territory.");
        const data = await response.json();
        const options = (data.locations || []) as AreaOption[];
        setChildren(options);
        setError("");
      })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { setChildren([]); setError(cause instanceof Error ? cause.message : "Could not load locations."); } })
      .finally(() => setLoadingChildren(false));
    return () => controller.abort();
  }, [selectedState]);

  const lgas = children.filter((item) => item.type === "LGA" || item.type === "AREA_COUNCIL");
  const cities = children.filter((item) => item.type === "CITY");

  return <fieldset className="live-merchant-location-fields">
    <legend className="text-xs font-semibold uppercase text-slate-500">Business location</legend>
    <div className="mt-2 grid md:grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-semibold text-slate-600" htmlFor="merchant-state-code">State / FCT</label>
        <select id="merchant-state-code" name="stateCode" required value={selectedState} onChange={(event) => { setSelectedState(event.target.value); setSelectedLga(""); setSelectedCity(""); setError(""); }} className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200" disabled={loadingStates || !!error}>
          <option value="">{loadingStates ? "Loading Nigerian states…" : "Choose a state or FCT"}</option>
          {states.map((state) => <option key={state.code} value={state.code}>{state.type === "TERRITORY" ? `${state.name} (FCT territory)` : state.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-600" htmlFor="merchant-lga-code">LGA / FCT area council</label>
        <select id="merchant-lga-code" name="lgaCode" required value={selectedLga} onChange={(event) => setSelectedLga(event.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200" disabled={!selectedState || loadingChildren || !!error}>
          <option value="">{!selectedState ? "Choose a state/FCT first" : loadingChildren ? "Loading local government areas…" : "Choose an LGA or area council"}</option>
          {lgas.map((area) => <option key={area.code} value={area.code}>{area.name}{area.type === "AREA_COUNCIL" ? " (Area Council)" : ""}</option>)}
        </select>
      </div>
      {cities.length > 0 && <div>
        <label className="text-xs font-semibold text-slate-600" htmlFor="merchant-city-code">City (optional)</label>
        <select id="merchant-city-code" name="cityCode" value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200" disabled={loadingChildren || !!error}>
          <option value="">No sourced city selected</option>
          {cities.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}
        </select>
        <small className="mt-1 block text-xs text-slate-500">Optional city names follow the source dataset and may need review.</small>
      </div>}
    </div>
    {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    <p className="mt-2 text-xs text-slate-500">Location codes are checked server-side. GPS coordinates are not required.</p>
  </fieldset>;
}
