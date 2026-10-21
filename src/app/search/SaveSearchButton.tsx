"use client";

import { useState } from "react";
import { Bell, Bookmark } from "lucide-react";

export default function SaveSearchButton({ query, filters, alertsSupported = true }: { query: string; filters: any; alertsSupported?: boolean }) {
  const [alerts, setAlerts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/saved-searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, filters, alertEnabled: alerts, alertFrequency: "DAILY" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save search");
      setMessage(data.note || "Saved to My Live.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save search."); }
    finally { setBusy(false); }
  };

  return <div className="mt-4 border-t border-slate-100 pt-4">
    <label className="live-alert-consent"><input type="checkbox" checked={alerts} disabled={!alertsSupported} onChange={(event) => setAlerts(event.target.checked)} /><span><Bell size={15} aria-hidden="true" /> Enable daily in-app availability alerts</span></label>
    {!alertsSupported && <p className="mt-2 text-xs text-amber-800" role="note">Distance-based alerts are unavailable because Live has no enabled location or routing source. You can still save this search.</p>}
    <button type="button" onClick={save} disabled={busy} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-live-black px-4 text-sm font-semibold text-white disabled:opacity-50"><Bookmark size={15} aria-hidden="true" />{busy ? "Saving…" : "Save to My Live"}</button>
    {message && <p className="mt-2 text-xs text-slate-600" role="status" aria-live="polite">{message}</p>}
  </div>;
}
