"use client";

import { useCallback, useEffect, useState } from "react";

type CaseEvent = { eventType: string; message: string; createdAt: string };
type ReportedCase = {
  id: string;
  caseCode: string;
  caseType: string;
  status: string;
  title: string;
  publicSummary: string | null;
  outcomeSummary: string | null;
  createdAt: string;
  events: CaseEvent[];
};
type ReservationRef = { id: string; code: string; status: string; createdAt: string; product: { name: string } | null; merchant: { businessName: string } };
type ServiceRef = { id: string; status: string; startTime: string; createdAt: string; service: { name: string } | null; merchant: { businessName: string } };
type PortalData = { cases: ReportedCase[]; references: { reservations: ReservationRef[]; serviceBookings: ServiceRef[] } };
type CaseType = "COMPLAINT" | "DISPUTE" | "IP_REPORT";
type ReferenceKind = "" | "reservation" | "serviceBooking";

const dateLabel = (value: string) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

export default function ComplaintsPortalClient() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [type, setType] = useState<CaseType>("COMPLAINT");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [listingId, setListingId] = useState("");
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>("");
  const [referenceId, setReferenceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/complaints", { cache: "no-store" });
      setLoadError("");
      if (response.status === 401) { setAuthRequired(true); setData(null); return; }
      const result = await response.json().catch(() => null) as PortalData & { error?: string } | null;
      if (!response.ok || !result) { setLoadError(result?.error || "Complaint status is temporarily unavailable."); return; }
      setAuthRequired(false);
      setData(result);
    } catch {
      setLoadError("Complaint status is temporarily unavailable. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies state only after its asynchronous fetch resolves.
    void load();
  }, [load]);

  const reservationOptions = data?.references.reservations ?? [];
  const serviceOptions = data?.references.serviceBookings ?? [];
  const transactionRequired = type === "DISPUTE";
  const listingRequired = type === "IP_REPORT";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const body: Record<string, string> = { type, subject, details };
    if (listingId.trim()) body.listingId = listingId.trim();
    if (referenceKind === "reservation" && referenceId) body.reservationId = referenceId;
    if (referenceKind === "serviceBooking" && referenceId) body.serviceBookingId = referenceId;
    try {
      const response = await fetch("/api/complaints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { error?: string; notice?: string; case?: { caseCode: string } } | null;
      if (!response.ok) { setFormError(result?.error || "The report could not be recorded."); return; }
      setNotice(`${result?.notice || "Report recorded."}${result?.case?.caseCode ? ` Reference: ${result.case.caseCode}.` : ""}`);
      setSubject("");
      setDetails("");
      setListingId("");
      setReferenceKind("");
      setReferenceId("");
      await load();
    } catch {
      setFormError("The report could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (authRequired) return <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm">Sign in to submit a report and view your case status.</p><a href="/auth/login?next=%2Fcomplaints" className="mt-3 inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">Sign in</a></div>;

  return <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="new-report-heading">
      <h2 id="new-report-heading" className="text-lg font-bold">Submit a complaint or report</h2>
      <p className="mt-1 text-sm text-slate-600">Reports are stored in a restricted case queue. Include only information needed to understand the issue; do not include passwords, card details, identity numbers, or unrelated sensitive data.</p>
      {notice && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</div>}
      {formError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">{formError}</div>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="report-type" className="text-sm font-semibold">Report type</label>
          <select id="report-type" value={type} onChange={(event) => { setType(event.target.value as CaseType); setFormError(""); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3">
            <option value="COMPLAINT">Product, service or platform complaint</option>
            <option value="DISPUTE">Reservation or appointment dispute</option>
            <option value="IP_REPORT">Intellectual-property report</option>
          </select>
        </div>
        <div>
          <label htmlFor="report-subject" className="text-sm font-semibold">Subject</label>
          <input id="report-subject" value={subject} onChange={(event) => setSubject(event.target.value)} minLength={4} maxLength={160} required className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" />
        </div>
        {listingRequired && <div>
          <label htmlFor="report-listing-id" className="text-sm font-semibold">Listing ID</label>
          <input id="report-listing-id" value={listingId} onChange={(event) => setListingId(event.target.value)} minLength={1} maxLength={64} required className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" aria-describedby="listing-id-help" />
          <p id="listing-id-help" className="mt-1 text-xs text-slate-600">Use the listing reference shown by Furnivo. The report is checked against the listing record; submitting a report is not a finding of infringement.</p>
        </div>}
        {(transactionRequired || type === "COMPLAINT") && <fieldset>
          <legend className="text-sm font-semibold">Related reservation or appointment{transactionRequired ? " (required)" : " (optional)"}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="reference-kind" className="sr-only">Choose reference type</label>
              <select id="reference-kind" value={referenceKind} onChange={(event) => { setReferenceKind(event.target.value as ReferenceKind); setReferenceId(""); }} required={transactionRequired} className="min-h-11 w-full rounded-xl border border-slate-300 px-3">
                <option value="">{transactionRequired ? "Choose a transaction" : "No transaction"}</option>
                <option value="reservation">Reservation</option>
                <option value="serviceBooking">Appointment</option>
              </select>
            </div>
            {referenceKind && <div>
              <label htmlFor="reference-id" className="sr-only">Choose a related transaction</label>
              {referenceKind === "reservation" ? <select id="reference-id" value={referenceId} onChange={(event) => setReferenceId(event.target.value)} required={transactionRequired} className="min-h-11 w-full rounded-xl border border-slate-300 px-3">
                <option value="">Choose reservation</option>
                {reservationOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.product?.name || "Product"} · {item.merchant.businessName} · {item.status.toLowerCase().replaceAll("_", " ")}</option>)}
              </select> : <select id="reference-id" value={referenceId} onChange={(event) => setReferenceId(event.target.value)} required={transactionRequired} className="min-h-11 w-full rounded-xl border border-slate-300 px-3">
                <option value="">Choose appointment</option>
                {serviceOptions.map((item) => <option key={item.id} value={item.id}>{item.service?.name || "Service"} · {item.merchant.businessName} · {dateLabel(item.startTime)}</option>)}
              </select>}
              {referenceKind === "reservation" && reservationOptions.length === 0 && <p className="mt-1 text-xs text-slate-600">No reservations are available on this account.</p>}
              {referenceKind === "serviceBooking" && serviceOptions.length === 0 && <p className="mt-1 text-xs text-slate-600">No appointments are available on this account.</p>}
            </div>}
          </div>
        </fieldset>}
        <div>
          <label htmlFor="report-details" className="text-sm font-semibold">What happened?</label>
          <textarea id="report-details" value={details} onChange={(event) => setDetails(event.target.value)} minLength={10} maxLength={4000} required rows={6} className="mt-1 w-full rounded-xl border border-slate-300 p-3" />
          <p className="mt-1 text-xs text-slate-600">Keep this factual and relevant. Do not paste confidential third-party material unless you are entitled to provide it.</p>
        </div>
        <button disabled={busy || loading || (transactionRequired && (!referenceKind || !referenceId))} className="min-h-11 rounded-full bg-slate-950 px-5 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Submitting…" : "Submit report"}</button>
      </form>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="case-status-heading">
      <div className="flex items-start justify-between gap-3"><div><h2 id="case-status-heading" className="text-lg font-bold">Your report status</h2><p className="mt-1 text-sm text-slate-600">Only reports submitted from this account are shown. No response time is promised.</p></div><button type="button" onClick={() => { setLoading(true); setLoadError(""); void load(); }} disabled={loading} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button></div>
      {loadError && <p className="mt-4 text-sm text-red-800" role="alert">{loadError}</p>}
      {!loading && !loadError && data?.cases.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">No reports are recorded on this account.</p>}
      <div className="mt-4 space-y-3">{data?.cases.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{item.title}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{item.status.toLowerCase().replaceAll("_", " ")}</span></div>
        <p className="mt-1 text-xs text-slate-600">{item.caseCode} · {item.caseType.toLowerCase().replaceAll("_", " ")} · submitted {dateLabel(item.createdAt)}</p>
        {item.publicSummary && <p className="mt-3 text-sm text-slate-800">{item.publicSummary}</p>}
        {item.outcomeSummary && <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Outcome update</p><p className="mt-1 text-sm">{item.outcomeSummary}</p></div>}
        {item.events.length > 0 && <ul className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">{item.events.map((event, index) => <li key={`${item.id}-${index}`} className="text-sm"><span className="text-xs text-slate-500">{dateLabel(event.createdAt)} · </span>{event.message}</li>)}</ul>}
      </article>)}</div>
    </section>
  </div>;
}
