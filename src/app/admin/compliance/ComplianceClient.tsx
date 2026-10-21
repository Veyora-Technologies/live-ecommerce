"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";

type Role = "SUPER" | "SECURITY" | "REVIEWER" | "SUPPORT";
type CaseRow = { id: string; caseCode: string; caseType: string; status: string; priority: string; title: string; assignedTo: { id: string; name: string } | null; merchant: { id: string; businessName: string } | null; dueAt: string | null; nextReviewAt: string | null; createdAt: string; updatedAt: string };
type Staff = { id: string; name: string; adminRole: string | null };
type VerificationRow = { id: string; merchantId: string; stage: string; evidenceType: string; outcomeNote: string | null; nextReviewAt: string | null; createdAt: string; updatedAt: string; merchant: { businessName: string; status: string } };
type Worklist = { cases: CaseRow[]; verificationCases: VerificationRow[]; moderationQueueCount: number | null; assignees: Staff[] };
type CaseDetail = {
  id: string; caseCode: string; caseType: string; status: string; priority: string; title: string; reporterSummary: string; internalSummary: string | null; publicSummary: string | null; outcome: string | null; outcomeSummary: string | null; awarenessAt: string | null; incidentKind: string | null; riskAssessment: string | null; containmentSummary: string | null; ndpcNotifiedAt: string | null; dataSubjectsNotifiedAt: string | null; externalReportReference: string | null; dueAt: string | null; nextReviewAt: string | null; assignedToId: string | null;
  assignedTo: { id: string; name: string } | null; merchant: { id: string; businessName: string; status: string } | null; listing: { id: string; title: string; lifecycleStatus: string; moderationStatus: string } | null; reservation: { id: string; code: string; status: string } | null; serviceBooking: { id: string; status: string; startTime: string; endTime: string; service: { name: string } } | null;
  events: Array<{ id: string; eventType: string; visibility: string; message: string | null; createdAt: string; actor: { id: string; name: string } }>;
  tasks: Array<{ id: string; title: string; status: string; assigneeId: string | null; assignee: { id: string; name: string; adminRole: string | null } | null; dueAt: string | null; nextReviewAt: string | null; outcome: string | null; createdAt: string; updatedAt: string }>;
  evidence: Array<{ id: string; evidenceType: string; referenceCode: string; summary: string | null; addedById: string; createdAt: string }>;
  verificationCase: { id: string; stage: string; evidenceType: string; evidenceRef: string | null; outcomeNote: string | null; nextReviewAt: string | null } | null;
};
type CaseCreateType = "COMPLAINT" | "DISPUTE" | "PRIVACY_REQUEST" | "PRIVACY_COMPLAINT" | "IP_REPORT" | "MODERATION" | "VERIFICATION" | "INCIDENT" | "OTHER";
const CASE_STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING", "ACTION_TAKEN", "RESOLVED", "CLOSED", "REJECTED"];
const CASE_TYPES_BY_ROLE: Record<Role, CaseCreateType[]> = { SUPER: ["COMPLAINT", "DISPUTE", "PRIVACY_REQUEST", "PRIVACY_COMPLAINT", "IP_REPORT", "MODERATION", "VERIFICATION", "INCIDENT", "OTHER"], SECURITY: ["PRIVACY_COMPLAINT", "INCIDENT"], REVIEWER: ["COMPLAINT", "DISPUTE", "IP_REPORT", "MODERATION", "VERIFICATION"], SUPPORT: ["COMPLAINT", "DISPUTE"] };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not set";
const inputDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const asIsoOrNull = (value: string) => value ? new Date(value).toISOString() : null;

export default function ComplianceClient({ role }: { role: Role }) {
  const [worklist, setWorklist] = useState<Worklist | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [createType, setCreateType] = useState<CaseCreateType>(CASE_TYPES_BY_ROLE[role][0]);
  const [createTitle, setCreateTitle] = useState("");
  const [createSummary, setCreateSummary] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [incidentKind, setIncidentKind] = useState("PERSONAL_DATA_BREACH");
  const [awarenessAt, setAwarenessAt] = useState("");
  const [caseStatus, setCaseStatus] = useState("OPEN");
  const [priority, setPriority] = useState("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeSummary, setOutcomeSummary] = useState("");
  const [publicSummary, setPublicSummary] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [riskAssessment, setRiskAssessment] = useState("UNKNOWN");
  const [containmentSummary, setContainmentSummary] = useState("");
  const [ndpcNotifiedAt, setNdpcNotifiedAt] = useState("");
  const [dataSubjectsNotifiedAt, setDataSubjectsNotifiedAt] = useState("");
  const [externalReportReference, setExternalReportReference] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/compliance", { cache: "no-store" });
      const result = await response.json().catch(() => null) as Worklist & { error?: string } | null;
      if (!response.ok || !result) { setError(result?.error || "Compliance worklist is unavailable."); return; }
      setError("");
      setWorklist(result);
      if (selectedId && !result.cases.some((item) => item.id === selectedId)) { setSelectedId(""); setDetail(null); }
    } catch {
      setError("Compliance worklist is unavailable. Check the connection and try again.");
    } finally { setLoading(false); }
  }, [selectedId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies state only after its asynchronous fetch resolves.
    void load();
  }, [load]);

  const filteredCases = useMemo(() => (worklist?.cases ?? []).filter((item) => !filter || item.status === filter || item.caseType === filter), [worklist, filter]);
  const canAssign = role !== "SUPPORT";
  const canAddEvidence = role === "SUPER" || role === "SECURITY";

  async function openCase(id: string) {
    setSelectedId(id); setDetail(null); setDetailLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/compliance?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { case?: CaseDetail; error?: string } | null;
      if (!response.ok || !result?.case) { setError(result?.error || "Case details are unavailable."); return; }
      setDetail(result.case);
      setCaseStatus(result.case.status);
      setPriority(result.case.priority);
      setAssigneeId(result.case.assignedToId || "");
      setDueAt(inputDateTime(result.case.dueAt));
      setNextReviewAt(inputDateTime(result.case.nextReviewAt));
      setOutcome(result.case.outcome || "");
      setOutcomeSummary(result.case.outcomeSummary || "");
      setPublicSummary("");
      setInternalNote("");
      setRiskAssessment(result.case.riskAssessment || "UNKNOWN");
      setContainmentSummary(result.case.containmentSummary || "");
      setNdpcNotifiedAt(inputDateTime(result.case.ndpcNotifiedAt));
      setDataSubjectsNotifiedAt(inputDateTime(result.case.dataSubjectsNotifiedAt));
      setExternalReportReference(result.case.externalReportReference || "");
    } catch {
      setError("Case details are unavailable. Check the connection and try again.");
    } finally { setDetailLoading(false); }
  }

  async function postAction(body: Record<string, unknown>, method: "POST" | "PATCH" = "PATCH") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/compliance", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { error?: string; case?: { id: string }; verificationCase?: { id: string } } | null;
      if (!response.ok) { setError(result?.error || "Operation was not recorded."); return false; }
      setMessage("Operation recorded. The audit trail and case status have been refreshed.");
      await load();
      const detailId = body.action === "verification-update" ? "" : typeof body.caseId === "string" ? body.caseId : selectedId;
      if (detailId) await openCase(detailId);
      else if (result?.case?.id) await openCase(result.case.id);
      return true;
    } catch {
      setError("Operation could not be recorded. Check the connection and try again.");
      return false;
    } finally { setBusy(false); }
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body: Record<string, unknown> = { caseType: createType, title: createTitle, reporterSummary: createSummary, ...(merchantId.trim() ? { merchantId: merchantId.trim() } : {}) };
    if (createType === "INCIDENT") {
      if (!awarenessAt) { setError("Set the incident awareness time before creating an incident record."); return; }
      body.incidentKind = incidentKind;
      body.awarenessAt = new Date(awarenessAt).toISOString();
    }
    const ok = await postAction(body, "POST");
    if (ok) { setCreateTitle(""); setCreateSummary(""); setMerchantId(""); setAwarenessAt(""); }
  }

  async function saveCaseTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const body: Record<string, unknown> = { action: "transition", caseId: detail.id, status: caseStatus, priority, dueAt: asIsoOrNull(dueAt), nextReviewAt: asIsoOrNull(nextReviewAt) };
    if (outcome) body.outcome = outcome;
    if (outcomeSummary.trim()) body.outcomeSummary = outcomeSummary.trim();
    if (publicSummary.trim()) body.publicSummary = publicSummary.trim();
    if (internalNote.trim()) body.internalNote = internalNote.trim();
    if (detail.caseType === "INCIDENT") {
      body.riskAssessment = riskAssessment;
      if (containmentSummary.trim()) body.containmentSummary = containmentSummary.trim();
      body.ndpcNotifiedAt = asIsoOrNull(ndpcNotifiedAt);
      body.dataSubjectsNotifiedAt = asIsoOrNull(dataSubjectsNotifiedAt);
      body.externalReportReference = externalReportReference.trim() || null;
    }
    await postAction(body);
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await postAction({ action: "add-task", caseId: detail.id, title: taskTitle, assigneeId: taskAssigneeId || null, dueAt: asIsoOrNull(taskDueAt), nextReviewAt: null });
    setTaskTitle(""); setTaskDueAt("");
  }

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const ok = await postAction({ action: "add-evidence-reference", caseId: detail.id, evidenceType, referenceCode: evidenceReference, summary: evidenceSummary || undefined });
    if (ok) { setEvidenceType(""); setEvidenceReference(""); setEvidenceSummary(""); }
  }

  const caseTypeOptions = CASE_TYPES_BY_ROLE[role];

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Restricted operations workspace · {role}</p><h1 className="mt-1 text-2xl font-black">Compliance casework</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Case access is role- and assignment-limited by the server. Evidence references point to separately controlled records; no documents are uploaded here. No regulatory determination or external reporting integration is implied.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setLoading(true); setError(""); void load(); }} disabled={loading || busy} className="min-h-10 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold">{loading ? "Refreshing…" : "Refresh worklist"}</button>{role === "SUPER" && <Link href="/admin/legal" className="inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">Legal and policy records</Link>}<Link href="/admin/privacy" className="inline-flex min-h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold">Privacy request queue</Link>{role === "SUPER" || role === "REVIEWER" ? <Link href="/admin/marketplace" className="inline-flex min-h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold">Listing moderation</Link> : null}</div></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {worklist && <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Visible cases</p><p className="mt-1 text-2xl font-black">{worklist.cases.length}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Verification queue</p><p className="mt-1 text-2xl font-black">{worklist.verificationCases.length}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Pending listing moderation</p><p className="mt-1 text-2xl font-black">{worklist.moderationQueueCount ?? "Role restricted"}</p></div></div>}

    {role !== "SUPPORT" ? <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="open-case-heading">
      <h2 id="open-case-heading" className="text-lg font-bold">Open an operations case</h2><p className="mt-1 text-sm text-slate-600">Use this for internal incidents, privacy complaints, moderation, verification review, or other operational tracking. Consumer complaint intake is available at <Link href="/complaints" className="underline">the public case portal</Link>.</p>
      <form onSubmit={createCase} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold">Case type<select value={createType} onChange={(event) => setCreateType(event.target.value as CaseCreateType)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{caseTypeOptions.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm font-semibold">Merchant reference (optional)<input value={merchantId} onChange={(event) => setMerchantId(event.target.value)} maxLength={64} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
        <label className="text-sm font-semibold md:col-span-2">Case title<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} minLength={4} maxLength={160} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
        <label className="text-sm font-semibold md:col-span-2">Reporter summary / operational facts<textarea value={createSummary} onChange={(event) => setCreateSummary(event.target.value)} minLength={10} maxLength={4000} rows={4} required className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label>
        {createType === "INCIDENT" && <><label className="text-sm font-semibold">Incident type<select value={incidentKind} onChange={(event) => setIncidentKind(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3"><option value="PERSONAL_DATA_BREACH">Potential personal data breach</option><option value="CYBER_SECURITY">Cybersecurity</option><option value="SAFETY">Safety</option><option value="MARKETPLACE_ABUSE">Marketplace abuse</option><option value="OTHER">Other</option></select></label><label className="text-sm font-semibold">Awareness time<input type="datetime-local" value={awarenessAt} onChange={(event) => setAwarenessAt(event.target.value)} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label></>}
        <button disabled={busy || loading} className="min-h-10 w-fit rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Recording…" : "Create case"}</button>
      </form>
    </section> : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">This role can work only cases assigned by an authorized operations manager.</p>}

    <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.5fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="queue-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="queue-heading" className="text-lg font-bold">Authorized case queue</h2><p className="mt-1 text-sm text-slate-600">Up to 100 records, filtered by your server-side role.</p></div><label className="text-xs font-semibold">Filter<select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 px-2"><option value="">All types and states</option>{CASE_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}{[...new Set((worklist?.cases ?? []).map((item) => item.caseType))].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label></div>
        {loading && <p className="mt-4 text-sm text-slate-600">Loading permitted cases…</p>}
        {!loading && filteredCases.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No cases in this visible worklist.</p>}
        <div className="mt-3 space-y-2">{filteredCases.map((item) => <button type="button" key={item.id} onClick={() => void openCase(item.id)} className={`w-full rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${selectedId === item.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}><span className="flex items-start justify-between gap-2"><strong className="text-sm">{item.title}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold">{item.status}</span></span><span className="mt-1 block text-xs text-slate-600">{item.caseCode} · {item.caseType.replaceAll("_", " ")} · {item.priority}</span><span className="mt-1 block text-xs text-slate-500">Owner: {item.assignedTo?.name || "Unassigned"} · due {dateLabel(item.dueAt)}</span></button>)}</div>
      </section>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="case-detail-heading">
        <h2 id="case-detail-heading" className="text-lg font-bold">Case details and actions</h2>
        {detailLoading && <p className="mt-4 text-sm text-slate-600">Loading case details…</p>}
        {!detail && !detailLoading && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Select a case from your authorized queue. Case details are not exposed until the server confirms access.</p>}
        {detail && <div className="mt-4 space-y-5">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">{detail.caseCode} · {detail.caseType.replaceAll("_", " ")}</p><h3 className="mt-1 text-xl font-bold">{detail.title}</h3><p className="mt-2 text-sm">{detail.reporterSummary}</p>{detail.internalSummary && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><strong>Internal summary</strong><p>{detail.internalSummary}</p></div>}
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-slate-500">Status / priority</dt><dd>{detail.status} · {detail.priority}</dd></div><div><dt className="font-semibold text-slate-500">Assigned to</dt><dd>{detail.assignedTo?.name || "Unassigned"}</dd></div>{detail.merchant && <div><dt className="font-semibold text-slate-500">Merchant</dt><dd>{detail.merchant.businessName} · {detail.merchant.status}</dd></div>}{detail.listing && <div><dt className="font-semibold text-slate-500">Listing</dt><dd>{detail.listing.title} · {detail.listing.moderationStatus}</dd></div>}{detail.reservation && <div><dt className="font-semibold text-slate-500">Reservation</dt><dd>{detail.reservation.code} · {detail.reservation.status}</dd></div>}{detail.serviceBooking && <div><dt className="font-semibold text-slate-500">Appointment</dt><dd>{detail.serviceBooking.service.name} · {detail.serviceBooking.status}</dd></div>}</dl>
          </div>

          {canAssign && <form onSubmit={(event) => { event.preventDefault(); void postAction({ action: "assign", caseId: detail.id, assigneeId: assigneeId || null }); }} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-4"><label className="min-w-[220px] flex-1 text-sm font-semibold">Case owner<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3"><option value="">Unassigned</option>{worklist?.assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.adminRole}</option>)}</select></label><button disabled={busy} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Save assignment</button></form>}

          <form onSubmit={saveCaseTransition} className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-bold">Update status and assessment</h3><p className="mt-1 text-xs text-slate-600">The API enforces valid transitions and requires outcome plus rationale when resolving or closing.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Status<select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{CASE_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-semibold">Priority<select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-semibold">Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-semibold">Next review<input type="datetime-local" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label></div>
            {(["RESOLVED", "CLOSED"].includes(caseStatus)) && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3"><option value="">Choose an outcome</option>{["ACTIONED", "NO_BREACH_FOUND", "REFERRED", "WITHDRAWN", "DUPLICATE", "OUT_OF_SCOPE", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">Outcome rationale<textarea value={outcomeSummary} onChange={(event) => setOutcomeSummary(event.target.value)} minLength={5} maxLength={1200} required rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label></div>}
            {detail.caseType === "INCIDENT" && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><h4 className="font-semibold">Incident assessment record</h4><p className="mt-1 text-xs">Record facts only. Notification fields record an action taken; they do not decide whether notification was legally required.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Risk assessment<select value={riskAssessment} onChange={(event) => setRiskAssessment(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{["UNKNOWN", "NO_IDENTIFIED_RISK", "RISK", "HIGH_RISK", "NOT_APPLICABLE"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-semibold">NDPC notified at (if sent)<input type="datetime-local" value={ndpcNotifiedAt} onChange={(event) => setNdpcNotifiedAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-semibold">Data subjects notified at (if sent)<input type="datetime-local" value={dataSubjectsNotifiedAt} onChange={(event) => setDataSubjectsNotifiedAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-semibold">External report reference<textarea value={externalReportReference} onChange={(event) => setExternalReportReference(event.target.value)} maxLength={128} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" /></label><label className="text-sm font-semibold sm:col-span-2">Containment summary<textarea value={containmentSummary} onChange={(event) => setContainmentSummary(event.target.value)} minLength={5} maxLength={1200} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label></div></div>}
            <label className="mt-3 block text-sm font-semibold">Reporter-visible update (optional)<textarea value={publicSummary} onChange={(event) => setPublicSummary(event.target.value)} maxLength={1200} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            {role !== "SUPPORT" && <label className="mt-3 block text-sm font-semibold">Internal note (restricted)<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>}
            {detail.caseType === "INCIDENT" && externalReportReference && <p className="mt-2 text-xs text-amber-950">Use only an opaque internal reference; external URLs and document contents are rejected.</p>}
            <button disabled={busy} className="mt-4 min-h-10 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">Save case update</button>
          </form>

          <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Tasks and review dates</h3>{detail.tasks.length === 0 && <p className="mt-2 text-sm text-slate-600">No operational tasks are recorded.</p>}<div className="mt-3 space-y-2">{detail.tasks.map((task) => <article key={`${task.id}:${task.updatedAt}`} className="rounded-lg bg-slate-50 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{task.title}</strong><span className="text-xs font-bold">{task.status}</span></div><p className="mt-1 text-xs text-slate-600">Owner: {task.assignee?.name || "Unassigned"} · due {dateLabel(task.dueAt)} · review {dateLabel(task.nextReviewAt)}</p><TaskStatusForm task={task} disabled={busy} onSave={(body) => postAction({ action: "update-task", taskId: task.id, ...body })} /></article>)}</div><form onSubmit={addTask} className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">New task title<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} minLength={4} maxLength={160} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>{canAssign && <label className="text-sm font-semibold">Assign task<select value={taskAssigneeId} onChange={(event) => setTaskAssigneeId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3"><option value="">Unassigned</option>{worklist?.assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.adminRole}</option>)}</select></label>}<label className="text-sm font-semibold">Due date<input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label><button disabled={busy} className="min-h-10 w-fit rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Create task</button></form></section>

          {canAddEvidence && <form onSubmit={addEvidence} className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Evidence reference (no file upload)</h3><p className="mt-1 text-xs text-slate-600">Record an opaque reference to an externally controlled evidence store. Do not enter file paths, URLs, passwords, or document contents.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Evidence type<input value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} minLength={3} maxLength={80} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold">Opaque reference code<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} minLength={3} maxLength={128} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm font-normal" /></label><label className="text-sm font-semibold sm:col-span-2">Short summary (optional)<input value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} maxLength={500} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label></div><button disabled={busy} className="mt-3 min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Record reference</button>{detail.evidence.length > 0 && <ul className="mt-4 space-y-2">{detail.evidence.map((evidence) => <li key={evidence.id} className="rounded-lg bg-slate-50 p-3 text-xs"><strong>{evidence.evidenceType}</strong> · <code>{evidence.referenceCode}</code> · {evidence.summary || "No summary"} · {dateLabel(evidence.createdAt)}</li>)}</ul>}</form>}

          <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Recorded event history</h3>{detail.events.length === 0 ? <p className="mt-2 text-sm text-slate-600">No visible events.</p> : <ol className="mt-3 space-y-3">{detail.events.map((event) => <li key={event.id} className="border-l-2 border-slate-200 pl-3"><p className="text-xs font-semibold">{event.eventType} · {event.visibility} · {event.actor.name}</p><p className="mt-1 text-sm">{event.message || "No message recorded."}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(event.createdAt)}</p></li>)}</ol>}</section>
        </div>}
      </section>
    </div>

    {worklist?.verificationCases.length ? <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="verification-heading"><h2 id="verification-heading" className="text-lg font-bold">Verification and licensing review status</h2><p className="mt-1 text-sm text-slate-600">These are review-stage records only; document presence or review does not establish identity, title, ownership, authority, or safety. The API prevents marking a record approved without configured validation controls.</p><div className="mt-4 space-y-3">{worklist.verificationCases.map((item) => <VerificationCard key={item.id} item={item} disabled={busy} onUpdate={(body) => postAction({ action: "verification-update", verificationCaseId: item.id, ...body })} />)}</div></section> : null}
  </div>;
}

function TaskStatusForm({ task, disabled, onSave }: { task: CaseDetail["tasks"][number]; disabled: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [status, setStatus] = useState(task.status);
  const [outcome, setOutcome] = useState(task.outcome || "");
  const [dueAt, setDueAt] = useState(inputDateTime(task.dueAt));
  const [nextReviewAt, setNextReviewAt] = useState(inputDateTime(task.nextReviewAt));
  return <form onSubmit={async (event) => { event.preventDefault(); await onSave({ status, ...(outcome.trim() ? { outcome: outcome.trim() } : {}), dueAt: asIsoOrNull(dueAt), nextReviewAt: asIsoOrNull(nextReviewAt) }); }} className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">Task status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 px-2">{["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Outcome (required to finish)<input value={outcome} onChange={(event) => setOutcome(event.target.value)} minLength={5} maxLength={1000} className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 px-2 font-normal" /></label><label className="text-xs font-semibold">Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 px-2" /></label><label className="text-xs font-semibold">Next review<input type="datetime-local" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 px-2" /></label><button disabled={disabled || (status === "DONE" && outcome.trim().length < 5)} className="min-h-9 w-fit rounded-full border border-slate-300 px-3 text-xs font-semibold disabled:opacity-50">Save task state</button></form>;
}

function VerificationCard({ item, disabled, onUpdate }: { item: VerificationRow; disabled: boolean; onUpdate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [stage, setStage] = useState(item.stage);
  const [note, setNote] = useState(item.outcomeNote || "");
  const [nextReviewAt, setNextReviewAt] = useState(inputDateTime(item.nextReviewAt));
  const stages = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "REJECTED", "SUSPENDED", "DUE_REVERIFICATION"];
  return <article className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{item.merchant.businessName}</h3><p className="text-xs text-slate-600">{item.evidenceType} · seller status {item.merchant.status} · review stage {item.stage}</p></div><p className="text-xs text-slate-600">Next review: {dateLabel(item.nextReviewAt)}</p></div><form onSubmit={async (event) => { event.preventDefault(); await onUpdate({ stage, outcomeNote: note, nextReviewAt: asIsoOrNull(nextReviewAt) }); }} className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold">Stage<select value={stage} onChange={(event) => setStage(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{stages.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-semibold">Next review<input type="datetime-local" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-semibold sm:col-span-3">Review note<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={5} maxLength={1200} required rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label><button disabled={disabled} className="min-h-10 w-fit rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Save review stage</button></form></article>;
}
