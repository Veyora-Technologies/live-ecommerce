"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeInternalPath } from "@/lib/auth-navigation";
import BrandLogo from "@/components/BrandLogo";

export default function LoginForm() {
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [loading, setLoading] = useState(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const sp = useSearchParams();
  const requestedNext = sp.get("next");

  useEffect(() => () => {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setErr("");
    setWarn("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrPhone, password, ...(needsMfa ? { mfaCode } : {}) }),
      });
      const data: any = await response.json().catch(() => null);

      if (data?.mfaRequired) {
        if (response.status === 503) {
          setNeedsMfa(false);
          setMfaCode("");
          setErr(data.error || "Two-factor authentication needs account recovery. Contact support.");
          return;
        }
        setNeedsMfa(true);
        setMfaCode("");
        setErr(data.error || "Enter the current code from your authenticator app.");
        return;
      }

      if (!response.ok || data?.ok !== true) {
        setErr(data?.error || "Sign-in failed. Check your details and try again.");
        return;
      }

      const landingPath = safeInternalPath(data.landingPath, "/");
      const destination = safeInternalPath(requestedNext, landingPath);
      if (data.warning) {
        setWarn(data.warning);
        redirectTimer.current = setTimeout(() => router.replace(destination), 2500);
        return;
      }
      router.replace(destination);
    } catch {
      setErr("Unable to reach Furnivo. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full min-w-0 max-w-[420px] rounded-[24px] border border-slate-200 bg-white p-6 sm:p-8">
      <div className="live-auth-brand-mark" aria-hidden="true"><BrandLogo variant="symbol" width={40} height={40} className="live-auth-brand-light" decorative /><BrandLogo variant="symbol-inverse" width={40} height={40} className="live-auth-brand-dark" decorative /></div>
      <h1 className="mt-4 text-2xl font-black">Welcome back to Furnivo</h1>
      <p className="text-sm text-slate-500">Sign in to reserve, track activity, and manage an authorized business workspace.</p>
      {err && <div id="login-error" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="assertive">{err}</div>}
      {warn && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status" aria-live="polite">{warn} Redirecting…</div>}

      {!needsMfa ? <>
        <label htmlFor="login-identifier" className="mt-6 block text-xs font-semibold uppercase text-slate-500">Email or phone</label>
        <input
          id="login-identifier"
          name="emailOrPhone"
          type="text"
          required
          minLength={3}
          maxLength={120}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          value={emailOrPhone}
          onChange={(event) => setEmailOrPhone(event.target.value)}
          aria-invalid={Boolean(err)}
          aria-describedby={err ? "login-error" : undefined}
          className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="login-password" className="block text-xs font-semibold uppercase text-slate-500">Password</label>
          <Link href="/auth/forgot" className="text-xs font-semibold text-live-green-ink underline-offset-2 hover:underline">Forgot password?</Link>
        </div>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(err)}
          aria-describedby={err ? "login-error" : undefined}
          className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        />
      </> : <>
        <label htmlFor="login-mfa" className="mt-6 block text-xs font-semibold uppercase text-slate-500">Authenticator code</label>
        <input
          id="login-mfa"
          name="mfaCode"
          value={mfaCode}
          onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="6-digit code"
          aria-invalid={Boolean(err)}
          aria-describedby={err ? "login-error" : "login-mfa-help"}
          className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4 tracking-[0.4em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        />
        <p id="login-mfa-help" className="mt-2 text-xs text-slate-500">Open your authenticator app and enter the current code for Furnivo.</p>
        <button
          type="button"
          onClick={() => { setNeedsMfa(false); setMfaCode(""); setErr(""); }}
          className="mt-3 min-h-10 text-sm font-semibold text-live-green-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >Use a different account</button>
      </>}

      <button type="submit" disabled={loading} className="mt-6 h-11 w-full rounded-full bg-live-black font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50">
        {loading ? "Checking…" : needsMfa ? "Verify code" : "Sign in"}
      </button>
      <div className="mt-4 text-center text-sm">No account? <Link href="/auth/register" className="font-semibold text-live-green-ink underline-offset-2 hover:underline">Create account</Link></div>
      <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">Use the credentials associated with your Furnivo account. Never share your password or authenticator code.</p>
    </form>
  );
}
