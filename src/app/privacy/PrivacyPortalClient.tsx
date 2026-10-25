"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type PrivacyRequest = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  complianceCase: { caseCode: string; status: string; publicSummary: string | null } | null;
};
type PortalResult = { requests: PrivacyRequest[]; notice?: string; error?: string };
type RequestType = "ACCESS" | "RECTIFY" | "OBJECT" | "DELETE";
const requestLabels: Record<RequestType, string> = {
  ACCESS: "Access or copy of my data",
  RECTIFY: "Correct my data",
  OBJECT: "Object to a use of my data",
  DELETE: "Request account deletion",
};
const dateLabel = (value: string) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

export default function PrivacyPortalClient({ initialMarketingConsent }: { initialMarketingConsent: boolean }) {
  const [data, setData] = useState<PortalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("ACCESS");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(initialMarketingConsent);
  const [savingConsent, setSavingConsent] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/privacy", { cache: "no-store" });
      setLoadError("");
      if (response.status === 401) { setAuthRequired(true); setData(null); return; }
      const result = await response.json().catch(() => null) as PortalResult | null;
      if (!response.ok || !result) { setLoadError(result?.error || "Privacy request status is temporarily unavailable."); return; }
      setAuthRequired(false);
      setData(result);
    } catch {
      setLoadError("Privacy request status is temporarily unavailable. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies state only after its asynchronous fetch resolves.
    void load();
  }, [load]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setFormError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: requestType, detail: detail.trim() || undefined }) });
      const result = await response.json().catch(() => null) as { error?: string; notice?: string; request?: { caseCode: string; type: string } } | null;
      if (!response.ok) { setFormError(result?.error || "Your request could not be recorded."); return; }
      setMessage(`${result?.notice || "Request recorded."}${result?.request?.caseCode ? ` Reference: ${result.request.caseCode}.` : ""}`);
      setDetail("");
      await load();
    } catch {
      setFormError("Your request could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMarketingPreference() {
    setSavingConsent(true); setFormError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketingConsent }) });
      const result = await response.json().catch(() => null) as { error?: string; preferences?: { marketingConsent: boolean } } | null;
      if (!response.ok) { setFormError(result?.error || "Marketing preference could not be saved."); return; }
      if (result?.preferences) setMarketingConsent(result.preferences.marketingConsent);
      setMessage("Marketing preference saved. This is separate from policy acceptance.");
    } catch {
      setFormError("Marketing preference could not be saved. Check your connection and try again.");
    } finally {
      setSavingConsent(false);
    }
  }

  async function downloadExport() {
    setExporting(true); setFormError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy?action=export", { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        setFormError(result?.error || "Your export could not be generated.");
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "live-data-export.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setMessage("Your data export was generated. Store the downloaded file securely.");
      await load();
    } catch {
      setFormError("Your export could not be generated. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  if (authRequired) return <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm">Sign in to export account data, manage marketing preferences, or submit a privacy request.</p><a href="/auth/login?next=%2Fprivacy" className="mt-3 inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">Sign in</a></div>;

  return <div className="mt-6 space-y-6">
    {(message || formError) && <div className={`rounded-xl border p-3 text-sm ${formError ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role={formError ? "alert" : "status"}>{formError || message}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="privacy-actions-heading">
      <h2 id="privacy-actions-heading" className="text-lg font-bold">Your account data and preferences</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void downloadExport()} disabled={exporting || loading} className="min-h-11 rounded-full bg-slate-950 px-5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{exporting ? "Preparing export…" : "Download my data"}</button>
        <a href="/notifications/preferences" className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-semibold">Notification channel preferences</a>
      </div>
      <p className="mt-2 text-xs text-slate-600">The export is generated for the signed-in account and downloaded by your browser. The file may contain personal data; keep it private.</p>
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="font-semibold">Marketing preference</h3>
        <p className="mt-1 text-sm text-slate-600">This preference is stored separately from terms acceptance and does not change essential account or transaction messages.</p>
        <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-700" /><span>Allow Furnivo marketing communications.</span></label>
        <button type="button" onClick={() => void saveMarketingPreference()} disabled={savingConsent} className="mt-3 min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">{savingConsent ? "Saving…" : "Save marketing preference"}</button>
      </div>
    </section>

    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold">Submit a privacy request</h2>
        <p className="mt-1 text-sm text-slate-600">Requests are recorded for review and are not automatically completed or a legal determination. Do not include passwords, card details, identity numbers, or other secrets.</p>
        <form onSubmit={submitRequest} className="mt-4 space-y-4">
          <div><label htmlFor="privacy-request-type" className="text-sm font-semibold">Request type</label><select id="privacy-request-type" value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3">{Object.entries(requestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor="privacy-request-detail" className="text-sm font-semibold">Details (optional)</label><textarea id="privacy-request-detail" value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Describe the data or change you are asking about." /><p className="mt-1 text-xs text-slate-600">Maximum 500 characters.</p></div>
          {requestType === "DELETE" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Submitting records a deletion request; it does not immediately delete the account. Existing transactions, legal obligations, and review requirements may affect handling.</p>}
          <button type="submit" disabled={busy || loading} className="min-h-11 rounded-full bg-slate-950 px-5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy ? "Submitting…" : "Submit privacy request"}</button>
        </form>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Request history</h2><p className="mt-1 text-sm text-slate-600">Status updates shown here are only those recorded for your account.</p></div><button type="button" onClick={() => { setLoading(true); setLoadError(""); void load(); }} disabled={loading} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button></div>
        {loadError && <p className="mt-4 text-sm text-red-800" role="alert">{loadError}</p>}
        {!loading && !loadError && data?.notice && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{data.notice}</p>}
        {!loading && !loadError && data?.requests.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">No privacy requests are recorded on this account.</p>}
        <div className="mt-3 space-y-3">{data?.requests.map((request) => <article key={request.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{requestLabels[request.type as RequestType] || request.type}</strong><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{request.status.toLowerCase().replaceAll("_", " ")}</span></div>
          <p className="mt-1 text-xs text-slate-600">Submitted {dateLabel(request.createdAt)}{request.complianceCase ? ` · ${request.complianceCase.caseCode}` : ""}</p>
          {request.complianceCase?.publicSummary && <p className="mt-2 text-sm">{request.complianceCase.publicSummary}</p>}
        </article>)}</div>
      </div>
    </section>
    <p className="text-sm text-slate-600">See the <a href="/legal#PRIVACY_NOTICE" className="font-semibold underline">published Privacy Notice</a> and the <a href="/legal" className="font-semibold underline">operator contacts and service availability</a>. The workspace does not publish a response-time commitment.</p>
  </div>;
}
