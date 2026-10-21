"use client";

import { useState } from "react";

type Props = {
  policyId: string;
  merchantId?: string;
  accepted: boolean;
  action: "ACCEPTED" | "ACKNOWLEDGED";
};

export default function PolicyAcceptanceButton({ policyId, merchantId, accepted: initialAccepted, action }: Props) {
  const [accepted, setAccepted] = useState(initialAccepted);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!confirmed || busy || accepted) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId, ...(merchantId ? { merchantId } : {}) }),
      });
      const result = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null;
      if (!response.ok || !result?.ok) {
        setError(result?.error || "Your acknowledgement could not be recorded. Please try again.");
      } else {
        setAccepted(true);
        setConfirmed(false);
      }
    } catch {
      setError("Your acknowledgement could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (accepted) return <p className="mt-3 text-sm font-semibold text-emerald-800" role="status">Current version recorded for this account{merchantId ? " and business" : ""}.</p>;

  return <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <label className="flex items-start gap-3 text-sm text-slate-800">
      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-700" />
      <span>{action === "ACCEPTED" ? "I have read this policy and agree to it." : "I have read this notice and acknowledge it."}{merchantId ? " I am the account owner for this business." : ""}</span>
    </label>
    {error && <p className="mt-2 text-sm text-red-800" role="alert">{error}</p>}
    <button type="button" onClick={submit} disabled={!confirmed || busy} className="mt-3 min-h-10 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
      {busy ? "Recording…" : action === "ACCEPTED" ? "Record acceptance" : "Record acknowledgement"}
    </button>
  </div>;
}
