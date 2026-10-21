"use client";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Inner() {
  const sp = useSearchParams(); const router = useRouter();
  const token = sp.get("token") || "";
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (pw !== pw2) { setErr("Passwords do not match."); return; }
    if (pw.length < 10) { setErr("Use at least 10 characters."); return; }
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Reset failed. Request a new reset link."); return; }
      setDone(true);
      setTimeout(() => router.push("/auth/login"), 2000);
    } catch {
      setErr("Unable to reach Live. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[420px] bg-white border border-slate-200 rounded-[24px] p-8">
      <h1 className="font-black text-2xl">Choose a new password</h1>
      <p className="text-sm text-slate-500 mt-1">At least 10 characters. All other devices will be signed out after the reset.</p>
      {!token && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm" role="alert">This link is incomplete. Request a new reset from the sign-in page.</div>}
      {err && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm" role="alert">{err}</div>}
      {done && <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-sm" role="status">Password updated. Taking you to sign in…</div>}
      <label className="mt-6 block text-xs font-semibold uppercase text-slate-500">New password</label>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" />
      <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">Confirm password</label>
      <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" />
      <button disabled={busy || !token || done} className="mt-6 w-full h-11 rounded-full bg-live-black text-white font-semibold disabled:opacity-50">{busy ? "Updating…" : "Update password"}</button>
    </form>
  );
}
export default function ResetPage() {
  return <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50"><Suspense fallback={<div>Loading…</div>}><Inner /></Suspense></div>;
}
