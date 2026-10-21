"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [devToken, setDevToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    setError("");
    setDevToken("");
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrPhone: email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Password-reset delivery is unavailable. No email was sent.");
        return;
      }
      setMsg(data.message || "If an account exists for that email, reset instructions have been prepared.");
      if (data.devResetToken) setDevToken(data.devResetToken);
    } catch {
      setError("Unable to reach Live. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-[420px] bg-white border border-slate-200 rounded-[24px] p-8">
        <h1 className="font-black text-2xl">Reset your password</h1>
        <p className="text-sm text-slate-500 mt-1">Enter your account email. For your safety we never confirm whether an email is registered.</p>
        {msg && <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-sm" role="status">{msg}</div>}
        {error && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm" role="alert">{error}</div>}
        {devToken && (
          <div className="mt-3 bg-slate-900 text-white rounded-xl px-3 py-2 text-xs break-all">
            Development only — no email provider configured. Reset link:
            <div className="mt-1"><Link className="underline text-emerald-300" href={`/auth/reset?token=${encodeURIComponent(devToken)}`}>Open reset page</Link></div>
          </div>
        )}
        <label className="mt-6 block text-xs font-semibold uppercase text-slate-500">Email</label>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" />
        <button disabled={busy} className="mt-6 w-full h-11 rounded-full bg-live-black text-white font-semibold disabled:opacity-50">{busy ? "Sending…" : "Send reset instructions"}</button>
        <div className="mt-4 text-center text-sm"><Link href="/auth/login" className="font-semibold text-live-green-ink">Back to sign in</Link></div>
      </form>
    </div>
  );
}
