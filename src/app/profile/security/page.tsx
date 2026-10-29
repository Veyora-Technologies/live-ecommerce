"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import Link from "next/link";
import { fetchWithStepUp } from "@/lib/step-up-client";

export default function SecurityPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [current, setCurrent] = useState(""); const [next, setNext] = useState("");
  const [mfaPw, setMfaPw] = useState(""); const [mfaData, setMfaData] = useState<any>(null); const [mfaCode, setMfaCode] = useState(""); const [mfaOn, setMfaOn] = useState<boolean | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    const s = await fetch("/api/auth/sessions").then(r => r.json()).catch(() => ({}));
    setSessions(s.sessions || []);
    const me = await fetch("/api/auth/me").then(r => r.json()).catch(() => ({}));
    setMfaOn(!!me?.user?.mfaEnabled);
  }
  useEffect(() => { load(); }, []);

  async function act(url: string, body: any, ok: string, method = "POST") {
    // Step-up aware: if the session has not proved the password recently, the
    // server answers 403 REAUTH_REQUIRED and this prompts once, then retries.
    const res = await fetchWithStepUp(url, { method, headers:{ "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? (data.message || ok) : (data.error || "Action failed"));
    if (res.ok) load();
    return { res, data };
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div><Link href="/profile" className="text-sm font-semibold text-live-green-ink">← Profile</Link>
        <h1 className="mt-2 text-3xl font-black">Account security</h1>
        <p className="text-slate-500 text-sm">Password, two-factor authentication, active sessions and your data.</p></div>
        {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-sm" role="status">{msg}</div>}

        <section className="bg-white border border-slate-200 rounded-3xl p-5">
          <h2 className="font-bold text-lg">Change password</h2>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <input type="password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-200" autoComplete="current-password" />
            <input type="password" placeholder="New password (10+ characters)" value={next} onChange={e => setNext(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-200" autoComplete="new-password" />
          </div>
          <button onClick={() => act("/api/auth/change-password", { currentPassword: current, newPassword: next }, "Password changed. Other devices were signed out.")} className="mt-3 h-10 px-5 rounded-full bg-live-black text-white text-sm font-semibold">Change password</button>
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-5">
          <h2 className="font-bold text-lg">Two-factor authentication (authenticator app)</h2>
          <p className="text-sm text-slate-500 mt-1">{mfaOn === null ? "Loading…" : mfaOn ? "Enabled. A 6-digit code is required at sign-in." : "Not enabled. Recommended for all accounts, especially administrators."}</p>
          {!mfaOn && <>
            <div className="mt-3 flex gap-2">
              <input type="password" placeholder="Your password" value={mfaPw} onChange={e => setMfaPw(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-200 flex-1" />
              <button onClick={async () => { const { res, data } = await act("/api/auth/mfa", { action: "begin", password: mfaPw }, ""); if (res.ok) setMfaData(data); }} className="h-10 px-5 rounded-full bg-live-black text-white text-sm font-semibold">Begin setup</button>
            </div>
            {mfaData && <div className="mt-3 text-sm space-y-2">
              {mfaData.qrDataUrl && <img src={mfaData.qrDataUrl} alt="Scan with your authenticator app" className="w-44 h-44 border rounded-xl" />}
              <div className="text-xs break-all bg-slate-50 rounded-xl p-2">Manual secret: <b>{mfaData.secret}</b></div>
              <div className="flex gap-2">
                <input value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" className="h-10 px-3 rounded-xl border border-slate-200 flex-1" inputMode="numeric" />
                <button onClick={() => act("/api/auth/mfa", { action: "confirm", code: mfaCode }, "Two-factor authentication enabled.")} className="h-10 px-5 rounded-full bg-live-green-ink text-white text-sm font-semibold">Confirm</button>
              </div>
            </div>}
          </>}
          {mfaOn && <div className="mt-3 flex gap-2">
            <input type="password" placeholder="Password" value={mfaPw} onChange={e => setMfaPw(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-200 flex-1" />
            <input value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Current code" className="h-10 px-3 rounded-xl border border-slate-200 w-36" inputMode="numeric" />
            <button onClick={() => act("/api/auth/mfa", { action: "disable", password: mfaPw, code: mfaCode }, "Two-factor authentication disabled.")} className="h-10 px-5 rounded-full bg-red-600 text-white text-sm font-semibold">Disable</button>
          </div>}
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-lg">Active sessions</h2>
          <button onClick={() => act("/api/auth/sessions", { all: true }, "All other sessions revoked.", "DELETE")} className="text-sm font-semibold text-red-600">Sign out everywhere</button></div>
          <div className="mt-3 space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between border border-slate-100 rounded-2xl px-3 py-2 text-sm">
                <div><div className="font-semibold">{s.current ? "This device" : "Another device"}</div><div className="text-xs text-slate-500 truncate max-w-[260px]">{s.userAgent || "Unknown browser"}</div><div className="text-xs text-slate-400">Last active {new Date(s.lastSeenAt).toLocaleString()}</div></div>
                {!s.current && <button onClick={() => act("/api/auth/sessions", { sessionId: s.id }, "Session revoked.", "DELETE")} className="text-xs font-semibold text-red-600">Revoke</button>}
              </div>
            ))}
            {!sessions.length && <div className="text-sm text-slate-400">No active sessions found.</div>}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-5">
          <h2 className="font-bold text-lg">Your data & privacy</h2>
          <p className="text-sm text-slate-500 mt-1">Merchants never see identifiable consumer search histories. Export a copy of your data or request account deletion.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/privacy?action=export" className="h-10 px-5 rounded-full bg-live-black text-white text-sm font-semibold inline-flex items-center">Export my data (JSON)</a>
            <button disabled={deleteBusy} onClick={async () => { if (!confirm("Request account deletion? An administrator will review and process it. Active reservations may delay completion.")) return; setDeleteBusy(true); await act("/api/privacy", { type: "DELETE" }, "Deletion requested."); setDeleteBusy(false); }} className="h-10 px-5 rounded-full border border-red-300 text-red-700 text-sm font-semibold">Request account deletion</button>
          </div>
        </section>
      </main>
    </div>
  );
}
