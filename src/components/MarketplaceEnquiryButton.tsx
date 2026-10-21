"use client";

import { useState } from "react";
import Link from "next/link";

type Props = {
  merchantId: string;
  productId?: string;
  serviceId?: string;
  listingTitle: string;
  kind: "PRODUCT" | "SERVICE";
  loggedIn: boolean;
};

export default function MarketplaceEnquiryButton({ merchantId, productId, serviceId, listingTitle, kind, loggedIn }: Props) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [type, setType] = useState(kind === "SERVICE" ? "SERVICE_AVAILABILITY" : "CONFIRM_STOCK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ id: string; message: string } | null>(null);
  const formId = `marketplace-enquiry-${productId || serviceId || merchantId}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loggedIn) return;
    if (!body.trim() || body.trim().length > 1000) { setError("Write a message of 1–1,000 characters."); return; }
    setBusy(true);
    setError("");
    setSuccess(null);
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, ...(productId ? { productId } : {}), ...(serviceId ? { serviceId } : {}), enquiryType: type, body: body.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Enquiry could not be sent.");
      setSuccess({ id: data.enquiry.id, message: data.contactSharing || "No phone number or address was shared." });
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enquiry could not be sent.");
    } finally { setBusy(false); }
  };

  if (!loggedIn) return <Link href={`/auth/login?next=${encodeURIComponent("/marketplace")}`} className="mt-2 inline-flex min-h-10 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-800">Sign in to enquire</Link>;

  return <div className="mt-2">
    <button type="button" aria-expanded={open} aria-controls={formId} onClick={() => { setOpen((current) => !current); setError(""); }} className="min-h-10 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Ask seller</button>
    {open && <form id={formId} onSubmit={submit} className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <label htmlFor={`${formId}-type`} className="text-xs font-semibold uppercase text-slate-600">Enquiry topic</label>
      <select id={`${formId}-type`} value={type} onChange={(event) => setType(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm">
        {kind === "SERVICE" ? <><option value="SERVICE_AVAILABILITY">Service availability</option><option value="ASK_PRICE">Ask about price</option><option value="OTHER">Other question</option></> : <><option value="CONFIRM_STOCK">Confirm current availability</option><option value="ASK_PRICE">Ask about price</option><option value="OTHER">Other question</option></>}
      </select>
      <label htmlFor={`${formId}-body`} className="mt-3 block text-xs font-semibold uppercase text-slate-600">Message about {listingTitle}</label>
      <textarea id={`${formId}-body`} value={body} onChange={(event) => setBody(event.target.value.slice(0, 1000))} maxLength={1000} rows={3} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" placeholder="Write your question" />
      <div className="mt-1 text-right text-xs text-slate-500">{body.length}/1,000</div>
      <p className="mt-2 text-xs leading-5 text-slate-600">No phone number or address is shared. Do not send payment details or leave Live for payment. For pharmacy products, contact a pharmacist for medicine-use or substitute questions.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
      {success && <div role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">Enquiry sent. {success.message}<Link href={`/enquiries?selected=${encodeURIComponent(success.id)}`} className="ml-1 font-semibold underline">Open conversation</Link></div>}
      <button disabled={busy || !body.trim()} className="mt-3 min-h-10 w-full rounded-full bg-live-black px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Sending…" : "Send enquiry"}</button>
    </form>}
  </div>;
}
