"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type ReviewFields = { reviewProfessional: string | null; reviewQualifications: string | null; reviewScope: string | null; reviewEvidenceReference: string | null; reviewedAt: string | null };
type LegalPolicy = ReviewFields & { id: string; key: string; version: number; title: string; content: string; acceptanceMode: string; status: string; createdAt: string; publishedAt: string | null; effectiveAt: string | null; createdById: string; publishedById: string | null };
type Operator = { legalName: string | null; tradingName: string | null; entityType: string | null; registrationNumber: string | null; registeredAddress: string | null; jurisdiction: string | null; publicContactEmail: string | null; privacyContactEmail: string | null; complaintsContactEmail: string | null; publicPhone: string | null; reviewProfessional: string | null; reviewQualifications: string | null; reviewScope: string | null; reviewEvidenceReference: string | null; reviewedAt: string | null; updatedById: string | null };
type Acceptance = { id: string; userId: string; action: string; merchantId: string | null; createdAt: string; policy: { key: string; version: number; title: string }; merchant: { businessName: string } | null; user: { name: string } };
type Gate = { ready: boolean; bypassedOutsideProduction: boolean; missing: string[]; publicMessage: string | null };
type Data = { operator: Operator | null; policies: LegalPolicy[]; acceptances: Acceptance[]; gates: { account: Gate; marketplace: Gate } };
type ReviewInput = { reviewProfessional: string; reviewQualifications: string; reviewScope: string; reviewEvidenceReference: string };
const POLICY_KEYS = ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS", "SELLER_AGREEMENT", "COMPLAINTS_PROCESS", "IP_REPORTING", "VERIFICATION_SCOPE", "PRODUCT_DISCLOSURES", "SERVICE_DISCLOSURES", "SERVICE_SCOPE"] as const;
const PROFILE_EMPTY = { legalName: "", tradingName: "", entityType: "", registrationNumber: "", registeredAddress: "", jurisdiction: "", publicContactEmail: "", privacyContactEmail: "", complaintsContactEmail: "", publicPhone: "" };
const REVIEW_EMPTY: ReviewInput = { reviewProfessional: "", reviewQualifications: "", reviewScope: "", reviewEvidenceReference: "" };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not recorded";

export default function LegalAdminClient() {
  const [data, setData] = useState<Data | null>(null);
  const [profile, setProfile] = useState(PROFILE_EMPTY);
  const [profileReview, setProfileReview] = useState(REVIEW_EMPTY);
  const [draftKey, setDraftKey] = useState<(typeof POLICY_KEYS)[number]>("PLATFORM_TERMS");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [reviewForms, setReviewForms] = useState<Record<string, ReviewInput>>({});
  const [draftEdits, setDraftEdits] = useState<Record<string, { title: string; content: string }>>({});
  const [withdrawReason, setWithdrawReason] = useState<Record<string, string>>({});
  const [acceptanceFilter, setAcceptanceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/legal", { cache: "no-store" });
      const result = await response.json().catch(() => null) as Data & { error?: string } | null;
      if (!response.ok || !result) { setError(result?.error || "Legal workspace could not be loaded."); return; }
      setError("");
      setData(result);
      setProfile(result.operator ? {
        legalName: result.operator.legalName || "", tradingName: result.operator.tradingName || "", entityType: result.operator.entityType || "", registrationNumber: result.operator.registrationNumber || "", registeredAddress: result.operator.registeredAddress || "", jurisdiction: result.operator.jurisdiction || "", publicContactEmail: result.operator.publicContactEmail || "", privacyContactEmail: result.operator.privacyContactEmail || "", complaintsContactEmail: result.operator.complaintsContactEmail || "", publicPhone: result.operator.publicPhone || "",
      } : PROFILE_EMPTY);
      setProfileReview({ ...REVIEW_EMPTY, ...(result.operator ? { reviewProfessional: result.operator.reviewProfessional || "", reviewQualifications: result.operator.reviewQualifications || "", reviewScope: result.operator.reviewScope || "", reviewEvidenceReference: result.operator.reviewEvidenceReference || "" } : {}) });
      setDraftEdits(Object.fromEntries(result.policies.filter((policy) => policy.status === "DRAFT").map((policy) => [policy.id, { title: policy.title, content: policy.content }])));
    } catch {
      setError("Legal workspace could not be loaded. Check your connection and try again.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies state only after its asynchronous fetch resolves.
    void load();
  }, [load]);

  async function send(body: Record<string, unknown>, method: "POST" | "PATCH" = "PATCH") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/legal", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { error?: string; policy?: { title?: string; version?: number }; operator?: Operator } | null;
      if (!response.ok) { setError(result?.error || "The change was not accepted."); return false; }
      setMessage(result?.policy ? `Policy action recorded${result.policy.title ? ` for ${result.policy.title}` : ""}.` : "Change recorded.");
      await load();
      return true;
    } catch {
      setError("The change could not be recorded. Check your connection and retry.");
      return false;
    } finally { setBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send({ action: "save-operator", ...profile });
  }
  async function recordProfileReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send({ action: "record-operator-review", ...profileReview });
  }
  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await send({ key: draftKey, title: draftTitle, content: draftContent }, "POST");
    if (ok) { setDraftTitle(""); setDraftContent(""); }
  }
  function updateReviewForm(policyId: string, patch: Partial<ReviewInput>) {
    setReviewForms((current) => ({ ...current, [policyId]: { ...REVIEW_EMPTY, ...current[policyId], ...patch } }));
  }

  const acceptances = (data?.acceptances ?? []).filter((item) => !acceptanceFilter || item.policy.key === acceptanceFilter);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">Legal and trust controls</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">SUPER-only policy administration. Draft text and review metadata are operator-entered; this workspace cannot verify a professional’s identity, the contents of external evidence, or legal sufficiency.</p></div><button type="button" onClick={() => { setLoading(true); setError(""); void load(); }} disabled={loading || busy} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold">{loading ? "Loading…" : "Refresh"}</button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <section className="grid gap-4 md:grid-cols-2" aria-label="Live release gates">{([['Account registration', data?.gates.account], ['Marketplace', data?.gates.marketplace]] as const).map(([label, gate]) => <div key={label} className={`rounded-2xl border p-4 ${gate?.ready && !gate.bypassedOutsideProduction ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}><h2 className="font-bold">{label} release gate</h2><p className="mt-1 text-sm">{!gate ? "Status unavailable." : gate.bypassedOutsideProduction ? "Non-production bypass active; not a production-readiness result." : gate.ready ? "Required records currently pass the application gate." : gate.publicMessage || "Blocked."}</p>{gate && !gate.ready && gate.missing.length > 0 && <p className="mt-2 text-xs">Missing records: {gate.missing.join(", ")}</p>}</div>)}</section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="operator-profile-heading">
      <h2 id="operator-profile-heading" className="text-lg font-bold">Actual operator identity and public contacts</h2>
      <p className="mt-1 text-sm text-slate-600">Enter verified Live details only; do not use examples or placeholders. Saving changes clears the profile’s prior review record.</p>
      <form onSubmit={saveProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
        {([['legalName','Legal name'],['tradingName','Trading name'],['entityType','Entity type'],['registrationNumber','Registration number'],['jurisdiction','Jurisdiction'],['publicContactEmail','Public contact email'],['privacyContactEmail','Privacy contact email'],['complaintsContactEmail','Complaints contact email'],['publicPhone','Public phone']] as const).map(([key,label]) => <label key={key} className="text-sm font-semibold">{label}<input type={key.toLowerCase().includes("email") ? "email" : "text"} value={profile[key]} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} maxLength={key === "legalName" || key === "tradingName" ? 160 : 254} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>)}
        <label className="text-sm font-semibold sm:col-span-2">Registered address<textarea value={profile.registeredAddress} onChange={(event) => setProfile((current) => ({ ...current, registeredAddress: event.target.value }))} maxLength={500} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label>
        <button disabled={busy} className="min-h-10 w-fit rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">Save actual operator details</button>
      </form>
      <div className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-semibold">Independent profile review record</h3><p className="mt-1 text-xs text-slate-600">The application requires a different SUPER account from the editor. Evidence references must be opaque internal codes, not URLs, paths, or document text.</p>
        <form onSubmit={recordProfileReview} className="mt-3 grid gap-3 sm:grid-cols-2">
          <ReviewInputs value={profileReview} onChange={(patch) => setProfileReview((current) => ({ ...current, ...patch }))} />
          <button disabled={busy} className="min-h-10 w-fit rounded-full border border-slate-300 px-5 text-sm font-semibold disabled:opacity-50">Record profile review</button>
        </form>
        <p className="mt-2 text-xs text-slate-600">Current review timestamp: {dateLabel(data?.operator?.reviewedAt ?? null)}. This record is an administrative assertion, not independent verification by this software.</p>
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="new-policy-heading">
      <h2 id="new-policy-heading" className="text-lg font-bold">Create policy draft</h2>
      <p className="mt-1 text-sm text-slate-600">Live does not generate legal wording. Enter only a draft approved for review. Publishing requires a recorded qualified review and a separate SUPER publisher.</p>
      <form onSubmit={createPolicy} className="mt-4 space-y-3">
        <label className="block text-sm font-semibold">Policy type<select value={draftKey} onChange={(event) => setDraftKey(event.target.value as (typeof POLICY_KEYS)[number])} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">{POLICY_KEYS.map((key) => <option key={key} value={key}>{key.replaceAll("_", " ")}</option>)}</select></label>
        <label className="block text-sm font-semibold">Policy title<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} minLength={4} maxLength={160} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
        <label className="block text-sm font-semibold">Full draft text<textarea value={draftContent} onChange={(event) => setDraftContent(event.target.value)} minLength={100} maxLength={50000} rows={8} required className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label>
        <button disabled={busy} className="min-h-10 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">Create new draft version</button>
      </form>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="policies-heading">
      <h2 id="policies-heading" className="text-lg font-bold">Policy versions and publication controls</h2>
      {!data?.policies.length && <p className="mt-3 text-sm text-slate-600">No policy versions are recorded.</p>}
      <div className="mt-4 space-y-4">{data?.policies.map((policy) => {
        const review = reviewForms[policy.id] ?? { ...REVIEW_EMPTY, reviewProfessional: policy.reviewProfessional || "", reviewQualifications: policy.reviewQualifications || "", reviewScope: policy.reviewScope || "", reviewEvidenceReference: policy.reviewEvidenceReference || "" };
        const edit = draftEdits[policy.id] ?? { title: policy.title, content: policy.content };
        return <article key={policy.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{policy.key.replaceAll("_", " ")} · version {policy.version}</p><h3 className="font-bold">{policy.title}</h3><p className="mt-1 text-xs text-slate-600">Status: {policy.status} · created {dateLabel(policy.createdAt)} · effective {dateLabel(policy.effectiveAt)}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{policy.acceptanceMode}</span></div>
          {(policy.status === "DRAFT") && <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
            <details><summary className="cursor-pointer text-sm font-semibold">Review or edit draft text</summary><div className="mt-3 space-y-3"><label className="block text-sm font-semibold">Title<input value={edit.title} onChange={(event) => setDraftEdits((current) => ({ ...current, [policy.id]: { ...edit, title: event.target.value } }))} maxLength={160} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="block text-sm font-semibold">Text<textarea value={edit.content} onChange={(event) => setDraftEdits((current) => ({ ...current, [policy.id]: { ...edit, content: event.target.value } }))} maxLength={50000} rows={8} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label><button type="button" onClick={() => void send({ action: "update-draft", policyId: policy.id, ...edit })} disabled={busy} className="min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Save draft edits</button></div></details>
            <details><summary className="cursor-pointer text-sm font-semibold">Record qualified review metadata</summary><p className="mt-1 text-xs text-slate-600">Only after actual review of this exact draft. Store an opaque evidence reference; do not paste legal advice or documents.</p><form onSubmit={(event) => { event.preventDefault(); void send({ action: "record-policy-review", policyId: policy.id, ...review }); }} className="mt-3 grid gap-3 sm:grid-cols-2"><ReviewInputs value={review} onChange={(patch) => updateReviewForm(policy.id, patch)} /><button disabled={busy} className="min-h-10 w-fit rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Record review metadata</button></form></details>
          </div>}
          {policy.status === "REVIEW_RECORDED" && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm"><p>Review metadata: {policy.reviewProfessional || "Not recorded"}; {policy.reviewQualifications || "Qualifications not recorded"}; reviewed {dateLabel(policy.reviewedAt)}.</p><button type="button" onClick={() => void send({ action: "publish-policy", policyId: policy.id })} disabled={busy} className="mt-3 min-h-10 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Publish (different SUPER required)</button></div>}
          {policy.status === "PUBLISHED" && <div className="mt-4 space-y-2 rounded-lg bg-emerald-50 p-3 text-sm"><p>Published {dateLabel(policy.publishedAt)}. Acceptance records are shown in the protected register below.</p><label className="block text-xs font-semibold">Withdrawal reason<textarea value={withdrawReason[policy.id] ?? ""} onChange={(event) => setWithdrawReason((current) => ({ ...current, [policy.id]: event.target.value }))} minLength={8} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" /></label><button type="button" onClick={() => { if (window.confirm("Withdraw this published policy? This will block any production feature requiring it until a reviewed replacement is published.")) void send({ action: "withdraw-policy", policyId: policy.id, reason: withdrawReason[policy.id] || "" }); }} disabled={busy || (withdrawReason[policy.id] || "").trim().length < 8} className="min-h-9 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">Withdraw policy</button></div>}
          <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">View stored policy text</summary><div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{policy.content}</div></details>
        </article>;
      })}</div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="acceptances-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="acceptances-heading" className="text-lg font-bold">Policy acceptance and seller-agreement records</h2><p className="mt-1 text-sm text-slate-600">Latest 500 records only. Merchant-scoped seller acceptance is separate from account-wide acceptance.</p></div><label className="text-sm font-semibold">Filter policy<select value={acceptanceFilter} onChange={(event) => setAcceptanceFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3"><option value="">All policies</option>{POLICY_KEYS.map((key) => <option key={key} value={key}>{key.replaceAll("_", " ")}</option>)}</select></label></div>
      {!acceptances.length ? <p className="mt-4 text-sm text-slate-600">No matching acceptance records in the returned 500-row window.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] border-collapse text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="p-2">Policy / version</th><th className="p-2">Account</th><th className="p-2">Business scope</th><th className="p-2">Action</th><th className="p-2">Recorded</th></tr></thead><tbody>{acceptances.map((acceptance) => <tr key={acceptance.id} className="border-b border-slate-100"><td className="p-2">{acceptance.policy.title} · v{acceptance.policy.version}</td><td className="p-2">{acceptance.user.name}</td><td className="p-2">{acceptance.merchant?.businessName || (acceptance.merchantId ? "Business not available" : "Account-wide")}</td><td className="p-2">{acceptance.action}</td><td className="p-2">{dateLabel(acceptance.createdAt)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function ReviewInputs({ value, onChange }: { value: ReviewInput; onChange: (patch: Partial<ReviewInput>) => void }) {
  return <>
    <label className="text-sm font-semibold">Professional name<input value={value.reviewProfessional} onChange={(event) => onChange({ reviewProfessional: event.target.value })} minLength={2} maxLength={160} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
    <label className="text-sm font-semibold">Qualifications<input value={value.reviewQualifications} onChange={(event) => onChange({ reviewQualifications: event.target.value })} minLength={2} maxLength={200} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
    <label className="text-sm font-semibold sm:col-span-2">Review scope<textarea value={value.reviewScope} onChange={(event) => onChange({ reviewScope: event.target.value })} minLength={10} maxLength={2000} rows={3} required className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label>
    <label className="text-sm font-semibold sm:col-span-2">Opaque review evidence reference<input value={value.reviewEvidenceReference} onChange={(event) => onChange({ reviewEvidenceReference: event.target.value })} minLength={3} maxLength={128} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm font-normal" /></label>
  </>;
}
