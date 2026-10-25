"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import Link from "next/link";
import { formatNaira } from "@/lib/utils";

export default function CartPage() {
  const [data, setData] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const d = await fetch("/api/cart").then(r => r.json()).catch(() => ({}));
    if (d.error) setErr("Sign in to view your plan."); else setData(d);
  }
  useEffect(() => { load(); }, []);

  async function remove(itemId: string) {
    await fetch("/api/cart/items", { method: "DELETE", headers:{ "Content-Type": "application/json" }, body: JSON.stringify({ itemId }) });
    load();
  }
  async function submit() {
    setBusy(true);
    const res = await fetch("/api/cart/submit", { method: "POST", headers:{ "Content-Type": "application/json" }, body: "{}" });
    const d = await res.json().catch(() => ({}));
    setBusy(false); setResult(d); load();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-black">My plan</h1>
        <p className="text-slate-500 text-sm mt-1">A planning cart across merchants. Nothing is reserved until submission. Each successful item becomes a separate pending pickup request with a temporary stock hold; no payment or delivery is arranged by Furnivo.</p>
        {err && <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm">{err} <Link href="/auth/login" className="font-semibold underline">Sign in</Link></div>}
        {result && (
          <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-4 text-sm space-y-1" role="status">
            <div className="font-bold">{result.message}</div>
            {(result.created || []).map((c: any) => <div key={c.reservationId} className="text-emerald-700">✓ Request {c.code} — pending merchant confirmation; temporary hold until {new Date(c.expiresAt).toLocaleString()}</div>)}
            {(result.failed || []).map((f: any, i: number) => <div key={i} className="text-red-600">✕ {f.name}: {f.reason}</div>)}
            <div>Track everything in <Link href="/activity" className="font-semibold underline">Activity</Link>.</div>
          </div>
        )}
        {!data && !err && <div className="mt-6 text-slate-400 text-sm">Loading your plan…</div>}
        {data && (data.groups?.length ? (
          <div className="mt-6 space-y-4">
            {data.groups.map((g: any) => (
              <section key={g.merchant.id} className="bg-white border border-slate-200 rounded-3xl p-5">
                <div className="font-bold">{g.merchant.name} <span className="text-slate-400 font-medium text-sm">· {g.merchant.area} · {g.merchant.storeStatus}</span></div>
                <div className="mt-3 space-y-2">
                  {g.items.map((i: any) => (
                    <div key={i.cartItemId} className="flex items-center justify-between gap-3 text-sm border-t border-slate-100 pt-2">
                      <div><div className="font-semibold">{i.name}{i.variantName ? ` — ${i.variantName}` : ""} ×{i.quantity}</div>
                        <div className="text-xs text-slate-500">{i.unitPrice === null ? (i.availability === "CURRENCY_UNSUPPORTED" ? `Price in ${i.currencyCode} is not supported for reservations in this market` : i.availability === "INVALID_QUANTITY" ? "This saved quantity needs correction" : "Selected option unavailable") : `${formatNaira(i.unitPrice)} each` } · {i.availability}{i.priceChanged ? ` · price changed${i.priceAtAdd === null ? " (saved original unavailable)" : ` from ${formatNaira(i.priceAtAdd)}`}` : ""}</div></div>
                      <div className="text-right"><div className="font-bold">{i.lineTotal === null ? "—" : formatNaira(i.lineTotal)}</div><button onClick={() => remove(i.cartItemId)} className="text-xs text-red-600 font-semibold">Remove</button></div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-right font-bold">Subtotal {formatNaira(g.subtotal)}</div>
              </section>
            ))}
            <div className="bg-slate-900 text-white rounded-3xl p-5">
              <div className="flex justify-between font-black text-lg"><span>Items total</span><span>{formatNaira(data.totalItemsValue)}</span></div>
              <p className="text-white/70 text-xs mt-1">{data.deliveryNote} {data.warning}</p>
              <button disabled={busy} onClick={submit} className="mt-3 w-full h-12 rounded-full bg-live-green text-live-black font-bold disabled:opacity-50">{busy ? "Submitting…" : "Submit as separate reservations"}</button>
              <p className="text-white/60 text-xs mt-2">No payment is taken. Prices are re-validated at submission; failed items stay in your plan.</p>
            </div>
          </div>
        ) : <div className="mt-8 bg-white border border-slate-200 rounded-3xl p-6 text-center text-slate-500">Your plan is empty. <Link href="/search" className="font-semibold text-live-green-ink">Find items nearby</Link></div>)}
      </main>
    </div>
  );
}
