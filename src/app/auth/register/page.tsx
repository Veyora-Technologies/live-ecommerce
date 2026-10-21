"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

type AccountPolicy = { id: string; key: string; title: string; version: number; acceptanceMode: "ACCEPT" | "ACKNOWLEDGE" | "NONE" };
type RegisterLegalInfo = {
  policies: AccountPolicy[];
  accountGate?: { ready: boolean; message: string | null; required: string[]; bypassedOutsideProduction: boolean };
};

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLegal, setLoadingLegal] = useState(true);
  const [legalError, setLegalError] = useState("");
  const [legalInfo, setLegalInfo] = useState<RegisterLegalInfo | null>(null);
  const [acceptedPolicyIds, setAcceptedPolicyIds] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/legal/policies", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as RegisterLegalInfo & { error?: string } | null;
        if (!response.ok || !result?.accountGate) throw new Error(result?.error || "Policy and release information could not be loaded.");
        setLegalInfo(result);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLegalError(cause instanceof Error ? cause.message : "Policy and release information could not be loaded.");
      })
      .finally(() => setLoadingLegal(false));
    return () => controller.abort();
  }, []);

  const requiredPolicies = useMemo(() => {
    if (legalInfo?.accountGate?.bypassedOutsideProduction) return [];
    const keys = new Set(["PLATFORM_TERMS", "PRIVACY_NOTICE"]);
    return (legalInfo?.policies ?? []).filter((policy) => keys.has(policy.key));
  }, [legalInfo]);
  const isProductionGateReady = legalInfo?.accountGate?.ready === true;
  const needsAcceptance = !legalInfo?.accountGate?.bypassedOutsideProduction;
  const acceptanceComplete = !needsAcceptance || (requiredPolicies.length === 2 && requiredPolicies.every((policy) => acceptedPolicyIds.includes(policy.id)));
  const formReady = !loadingLegal && !legalError && isProductionGateReady && acceptanceComplete;

  function togglePolicy(policyId: string, checked: boolean) {
    setAcceptedPolicyIds((current) => checked ? [...new Set([...current, policyId])] : current.filter((id) => id !== policyId));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() && !phone.trim()) { setErr("Enter an email address or phone number."); return; }
    if (!formReady) { setErr("Resolve the policy and release requirements shown above before creating an account."); return; }
    setLoading(true);
    setErr("");
    try {
      const policyAcceptances = requiredPolicies.filter((policy) => acceptedPolicyIds.includes(policy.id)).map((policy) => ({ policyId: policy.id }));
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, password, policyAcceptances }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) setErr(result?.error || "Account registration failed. Please try again.");
      else router.push("/");
    } catch {
      setErr("Account registration failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
    <form onSubmit={submit} className="w-full max-w-[480px] bg-white border border-slate-200 rounded-[24px] p-6 sm:p-8">
      <div className="live-auth-brand-mark" aria-hidden="true"><BrandLogo variant="symbol" width={40} height={40} className="live-auth-brand-light" decorative /><BrandLogo variant="symbol-inverse" width={40} height={40} className="live-auth-brand-dark" decorative /></div>
      <h1 className="mt-4 font-black text-2xl">Create your Live account</h1>
      <p className="text-sm text-slate-600">Create an account to use Live’s available account features.</p>
      {err && <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm" role="alert">{err}</div>}
      {loadingLegal && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700" role="status">Loading current policy and release information…</p>}
      {legalError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{legalError} Registration remains unavailable until the current information can be checked.</p>}
      {!loadingLegal && legalInfo?.accountGate && <div className={`mt-4 rounded-xl border p-3 text-sm ${legalInfo.accountGate.ready ? "border-slate-200 bg-slate-50 text-slate-700" : "border-amber-300 bg-amber-50 text-amber-950"}`} role="status">
        {legalInfo.accountGate.bypassedOutsideProduction ? "Non-production policy-gate bypass is active. This does not imply production readiness." : legalInfo.accountGate.ready ? "Account release information is available." : `${legalInfo.accountGate.message || "Account registration is not available in production."}${legalInfo.accountGate.required.length ? ` Not recorded: ${legalInfo.accountGate.required.join(", ")}.` : ""}`}
      </div>}
      <label htmlFor="register-name" className="mt-5 block text-xs font-semibold uppercase text-slate-600">Full name</label>
      <input id="register-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} autoComplete="name" className="mt-1 w-full min-h-11 px-4 rounded-xl border border-slate-300" required />
      <label htmlFor="register-email" className="mt-4 block text-xs font-semibold uppercase text-slate-600">Email (optional)</label>
      <input id="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={120} autoComplete="email" className="mt-1 w-full min-h-11 px-4 rounded-xl border border-slate-300" />
      <label htmlFor="register-phone" className="mt-4 block text-xs font-semibold uppercase text-slate-600">Phone (optional)</label>
      <input id="register-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} maxLength={20} autoComplete="tel" className="mt-1 w-full min-h-11 px-4 rounded-xl border border-slate-300" />
      <p className="mt-1 text-xs text-slate-600">At least one of email or phone is required.</p>
      <label htmlFor="register-password" className="mt-4 block text-xs font-semibold uppercase text-slate-600">Password</label>
      <input id="register-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={200} autoComplete="new-password" className="mt-1 w-full min-h-11 px-4 rounded-xl border border-slate-300" required />
      {needsAcceptance && requiredPolicies.length > 0 && <fieldset className="mt-5 space-y-3 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Review current account policies</legend>
        {requiredPolicies.map((policy) => <label key={policy.id} className="flex items-start gap-3 text-sm leading-5">
          <input type="checkbox" checked={acceptedPolicyIds.includes(policy.id)} onChange={(event) => togglePolicy(policy.id, event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-700" />
          <span>{policy.acceptanceMode === "ACCEPT" ? "I have read and agree to" : "I have read and acknowledge"} <Link href={`/legal#${policy.key}`} target="_blank" className="font-semibold text-emerald-800 underline">{policy.title}, version {policy.version}</Link>.</span>
        </label>)}
      </fieldset>}
      {needsAcceptance && legalInfo?.accountGate?.ready && requiredPolicies.length !== 2 && <p className="mt-3 text-sm text-amber-900">The current account policies could not be confirmed. Registration remains unavailable.</p>}
      <button disabled={!formReady || loading} className="mt-6 w-full min-h-11 rounded-full bg-live-black text-white font-semibold disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Creating…" : "Create account"}</button>
      <p className="mt-4 text-center text-sm">Have an account? <Link href="/auth/login" className="font-semibold text-emerald-800 underline">Sign in</Link></p>
      <p className="mt-3 text-center text-xs text-slate-500"><Link href="/legal" className="underline">Policies and service availability</Link></p>
    </form>
  </div>;
}
