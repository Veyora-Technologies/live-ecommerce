"use client";

import { useCallback, useEffect, useState } from "react";

type RequestRow = { id: string; type: string; status: string; createdAt: string; updatedAt: string; approvedAt: string | null; complianceCase: { id: string; caseCode: string; status: string; assignedTo: { name: string } | null; dueAt: string | null; nextReviewAt: string | null } | null };
type Data = { requests: RequestRow[] };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not set";

export default function PrivacyAdminClient() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/privacy", { cache: "no-store" });
      const result = await response.json().catch(() => null) as Data & { error?: string } | null;
      if (!response.ok || !result) { setError(result?.error || "Privacy request queue is unavailable."); return; }
      setError("");
      setRequests(result.requests);
    } catch {
      setError("Privacy request queue is unavailable. Check your connection and try again.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies state only after its asynchronous fetch resolves.
    void load();
  }, [load]);

  async function act(id: string, body: Record<string, string>) {
    setBusyId(id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const result = await response.json().catch(() => null) as { error?: string; note?: string } | null;
      if (!response.ok) { setError(result?.error || "The request was not changed."); return; }
      setMessage(result?.note || "Privacy-request action recorded.");
      await load();
    } catch {
      setError("The request was not changed. Check your connection and try again.");
    } finally { setBusyId(""); }
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Restricted to SUPER and SECURITY roles</p><h1 className="mt-1 text-2xl font-black">Privacy request queue</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">The queue omits request details and account identity. Deletion uses two distinct operators, checks for active reservations and appointments, revokes sessions, and anonymizes selected data. Some transaction, policy, security, and audit records remain; retention decisions still need qualified review.</p></div><button type="button" onClick={() => { setLoading(true); setError(""); void load(); }} disabled={loading || Boolean(busyId)} className="min-h-10 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold">{loading ? "Loading…" : "Refresh queue"}</button></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <div className="space-y-3">{requests.map((request) => <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{request.type.replaceAll("_", " ")}</p><h2 className="mt-1 text-lg font-bold">Request status: {request.status.replaceAll("_", " ")}</h2><p className="mt-1 text-sm text-slate-600">Submitted {dateLabel(request.createdAt)} · updated {dateLabel(request.updatedAt)}{request.complianceCase ? ` · case ${request.complianceCase.caseCode}` : ""}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{request.status}</span></div>
      {request.complianceCase && <p className="mt-2 text-xs text-slate-600">Case owner: {request.complianceCase.assignedTo?.name || "Unassigned"} · due {dateLabel(request.complianceCase.dueAt)} · next review {dateLabel(request.complianceCase.nextReviewAt)}</p>}
      {request.type === "DELETE" && request.status === "PENDING" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm">Approve deletion request for independent completion. Do not approve your own request; the server enforces the separate-operator requirement.</p><button type="button" onClick={() => void act(request.id, { action: "approve-delete" })} disabled={Boolean(busyId)} className="mt-3 min-h-10 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busyId === request.id ? "Recording…" : "Approve for second-operator review"}</button></div>}
      {request.type === "DELETE" && request.status === "APPROVED" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm">A different administrator must complete deletion. The server checks for active reservations and appointments before anonymizing; it does not remove every legal, transaction, policy, or audit record.</p>{request.approvedAt && <p className="mt-1 text-xs">Approval recorded {dateLabel(request.approvedAt)}.</p>}<button type="button" onClick={() => void act(request.id, { action: "complete-delete" })} disabled={Boolean(busyId)} className="mt-3 min-h-10 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{busyId === request.id ? "Processing…" : "Complete deletion (distinct operator required)"}</button></div>}
      {request.type !== "DELETE" && ["PENDING", "APPROVED"].includes(request.status) && <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 p-4 lg:grid-cols-2"><label className="text-sm font-semibold">Completion outcome<textarea value={outcomes[request.id] ?? ""} onChange={(event) => setOutcomes((current) => ({ ...current, [request.id]: event.target.value }))} minLength={10} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label><div className="space-y-3"><button type="button" onClick={() => void act(request.id, { action: "complete", outcome: outcomes[request.id] || "" })} disabled={Boolean(busyId) || (outcomes[request.id] || "").trim().length < 10} className="min-h-10 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busyId === request.id ? "Recording…" : "Record completion"}</button><label className="block text-sm font-semibold">Rejection rationale<input value={reasons[request.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} minLength={10} maxLength={500} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label><button type="button" onClick={() => void act(request.id, { action: "reject", reason: reasons[request.id] || "" })} disabled={Boolean(busyId) || (reasons[request.id] || "").trim().length < 10} className="min-h-10 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">Reject request</button></div></div>}
    </article>)}</div>
    {!loading && requests.length === 0 && !error && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">No privacy requests have been recorded.</p>}
  </div>;
}
