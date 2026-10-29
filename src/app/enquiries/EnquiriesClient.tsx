"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Enquiry = {
  id: string;
  merchantId: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  side: "CONSUMER" | "MERCHANT";
  merchant: { id: string; businessName: string } | null;
  product: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
};
type Message = { id: string; body: string; createdAt: string; side: "CONSUMER" | "MERCHANT" };

export default function EnquiriesClient() {
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedIdRef = useRef<string | null>(null);

  const loadThread = useCallback(async (id: string) => {
    const response = await fetch(`/api/enquiries?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Conversation could not be loaded.");
    selectedIdRef.current = id;
    setSelected(data.enquiry || null);
    setMessages(Array.isArray(data.messages) ? data.messages : []);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/enquiries", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Enquiries could not be loaded.");
      const nextRows: Enquiry[] = Array.isArray(data.enquiries) ? data.enquiries : [];
      setRows(nextRows);
      const requestedId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("selected") : null;
      const desired = [requestedId, selectedIdRef.current, nextRows[0]?.id].find((id) => id && nextRows.some((row) => row.id === id));
      if (desired) await loadThread(desired);
      else { selectedIdRef.current = null; setSelected(null); setMessages([]); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enquiries could not be loaded.");
    } finally { setLoading(false); }
  }, [loadThread]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  const openThread = async (row: Enquiry) => {
    setSelected(row);
    setError("");
    try { await loadThread(row.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Conversation could not be loaded."); }
  };

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/enquiries", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enquiryId: selected.id, body: draft.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Reply was not sent.");
      setMessages((current) => [...current, data.message]);
      setDraft("");
      if (data.flagged) setNotice(data.flagged);
      await loadRows();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reply was not sent."); }
    finally { setBusy(false); }
  };

  const closeThread = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/enquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enquiryId: selected.id, action: "close" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Conversation could not be closed.");
      setSelected(data.enquiry);
      setRows((current) => current.map((row) => row.id === selected.id ? data.enquiry : row));
      setNotice("Conversation closed. This does not cancel a product reservation or service appointment.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Conversation could not be closed."); }
    finally { setBusy(false); }
  };

  const reportThread = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || reportReason.trim().length < 2) { setError("Enter a reason of at least 2 characters."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/enquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enquiryId: selected.id, action: "report", reason: reportReason.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Report was not submitted.");
      setReportReason("");
      setNotice(data.note || "Report submitted for human review. The conversation was not automatically blocked.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Report was not submitted."); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto max-w-[1100px] px-4 py-6 pb-24">
    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">FURNIVO · private conversations</p>
    <h1 className="mt-1 text-2xl font-black text-slate-950">Marketplace enquiries</h1>
    <p className="mt-2 max-w-3xl text-sm text-slate-600">Messages are visible only to the buyer and authorized merchant participants. Phone numbers and addresses are not shared by this feature. Enquiries, reservations, and appointments are separate records.</p>
    {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

    <div className="mt-5 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-label="Your enquiry threads" className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between px-2 py-2"><h2 className="font-bold">Inbox</h2><button type="button" onClick={() => void loadRows()} className="text-sm font-semibold text-emerald-800 underline">Refresh</button></div>
        {loading && <p className="p-3 text-sm text-slate-500">Loading conversations…</p>}
        {!loading && rows.length === 0 && <p className="p-3 text-sm text-slate-500">No marketplace enquiries are recorded for this account or its merchant memberships.</p>}
        <div className="space-y-1">
          {rows.map((row) => <button type="button" key={row.id} aria-current={selected?.id === row.id ? "true" : undefined} onClick={() => void openThread(row)} className={`w-full rounded-xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${selected?.id === row.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
            <span className="block truncate font-semibold text-slate-900">{row.product?.name || row.service?.name || row.merchant?.businessName || "Marketplace enquiry"}</span>
            <span className="mt-1 block text-xs text-slate-500">{row.side === "CONSUMER" ? `To ${row.merchant?.businessName || "merchant"}` : "Buyer enquiry"} · {row.status.replaceAll("_", " ")}</span>
            <span className="mt-1 block text-xs text-slate-400">{new Date(row.updatedAt).toLocaleString()}</span>
          </button>)}
        </div>
      </section>

      <section aria-label="Selected enquiry conversation" className="min-h-[420px] rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        {!selected ? <div className="grid min-h-[380px] place-items-center text-center text-sm text-slate-500">Select a conversation to view messages.</div> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{selected.side === "CONSUMER" ? "Buyer" : "Merchant"}</span><h2 className="mt-2 font-bold text-slate-950">{selected.product?.name || selected.service?.name || selected.subject}</h2><p className="mt-1 text-sm text-slate-600">{selected.side === "CONSUMER" ? `With ${selected.merchant?.businessName || "merchant"}` : selected.merchant?.businessName}</p></div>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{selected.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto" aria-live="polite">
            {messages.map((message) => <div key={message.id} className={`flex ${message.side === selected.side ? "justify-end" : "justify-start"}`}>
              <article className={`max-w-[90%] rounded-2xl p-3 sm:max-w-[75%] ${message.side === selected.side ? "bg-live-black text-white" : "bg-slate-100 text-slate-900"}`}>
                <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className={`mt-2 text-[11px] ${message.side === selected.side ? "text-white/65" : "text-slate-500"}`}>{message.side === selected.side ? "You" : selected.side === "CONSUMER" ? "Merchant" : "Buyer"} · {new Date(message.createdAt).toLocaleString()}</p>
              </article>
            </div>)}
            {messages.length === 0 && <p className="text-sm text-slate-500">No messages in this conversation yet.</p>}
          </div>
          {selected.status === "OPEN" || selected.status === "ANSWERED" ? <form onSubmit={sendMessage} className="mt-4 border-t border-slate-100 pt-4">
            <label htmlFor="enquiry-reply" className="text-xs font-semibold uppercase text-slate-500">Reply · max 1,000 characters</label>
            <textarea id="enquiry-reply" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 1000))} maxLength={1000} rows={3} required className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Write a reply in Furnivo" />
            <div className="flex flex-wrap justify-between gap-2"><span className="text-xs text-slate-500">{draft.length}/1,000 · Do not send payment or sensitive identity details.</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void closeThread()} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Close conversation</button><button disabled={busy || !draft.trim()} className="min-h-10 rounded-full bg-live-black px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Sending…" : "Send reply"}</button></div></div>
          </form> : <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">This conversation is closed. It does not change a reservation or appointment.</p>}
          <details className="mt-4 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Report this conversation for review</summary>
            <form onSubmit={reportThread} className="mt-3">
              <label htmlFor="enquiry-report-reason" className="text-xs font-semibold uppercase text-slate-500">Reason</label>
              <textarea id="enquiry-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value.slice(0, 500))} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" required placeholder="Describe the concern for a human reviewer" />
              <button type="submit" disabled={busy || reportReason.trim().length < 2} className="min-h-10 rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 disabled:opacity-50">Submit report</button>
              <p className="mt-1 text-xs text-slate-500">A report is a signal, not a proven finding, and will not automatically block the other participant.</p>
            </form>
          </details>
        </>}
      </section>
    </div>
  </main>;
}
