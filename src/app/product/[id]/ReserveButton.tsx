"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNairaMinor } from "@/lib/money";

type Variant = { id: string; name: string; unit?: string | null; priceDelta: number; effectivePrice: number; availableQuantity: number };

export default function ReserveButton({ productId, inStock, basePrice }: { productId: string; inStock: boolean; basePrice?: number }) {
  const [qty, setQty] = useState(1);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantId, setVariantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/merchant/variants?productId=${encodeURIComponent(productId)}`)
      .then(r => r.json()).then(d => setVariants(d.variants || [])).catch(() => {});
  }, [productId]);

  const reserve = async () => {
    setLoading(true); setMsg("");
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers:{ "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ productId, quantity: qty, ...(variantId ? { variantId } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setMsg(data.error || "Failed"); if (res.status === 401) router.push("/auth/login"); return; }
    setMsg(`Request submitted. Code ${data.reservation.code} • Pending merchant confirmation; a temporary stock hold expires at ${new Date(data.reservation.expiresAt).toLocaleString()}. No payment was taken.`);
    setTimeout(() => router.push("/activity"), 1200);
  };

  const addToPlan = async () => {
    const res = await fetch("/api/cart/items", { method: "POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify({ productId, quantity: qty, ...(variantId ? { variantId } : {}) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data.error || "Could not add"); if (res.status === 401) router.push("/auth/login"); return; }
    setMsg("Added to your plan. It is not reserved until you submit the plan and the merchant confirms.");
  };

  if (!inStock) return <button disabled className="w-full h-12 rounded-full bg-slate-200 text-slate-500 font-semibold">Out of stock</button>;

  return (
    <div>
      {variants.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs font-semibold uppercase text-slate-500">Exact variant</label>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose variant">
            {variants.map(v => (
              <button key={v.id} role="radio" aria-checked={variantId === v.id} onClick={() => setVariantId(v.id)}
                className={`px-3 py-1.5 rounded-full border text-sm font-medium ${variantId === v.id ? "bg-live-black text-white border-live-black" : "border-slate-300 bg-white"}`}>
                {v.name} · {formatNairaMinor(v.effectivePrice)}{v.priceDelta ? ` (${v.priceDelta > 0 ? "+" : ""}${formatNairaMinor(v.priceDelta)})` : ""} · {v.availableQuantity} avail.
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">Pick the exact size/pack — similar-looking sizes are never merged.</div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-100 rounded-full px-2 py-1">
          <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity" className="w-8 h-8 rounded-full bg-white border border-slate-200">−</button>
          <span className="w-8 text-center font-bold">{qty}</span>
          <button onClick={() => setQty(Math.min(20, qty + 1))} aria-label="Increase quantity" className="w-8 h-8 rounded-full bg-white border border-slate-200">+</button>
        </div>
        <button onClick={reserve} disabled={loading} className="flex-1 h-12 rounded-full bg-live-green-ink text-white font-bold disabled:opacity-50">
          {loading ? "Reserving…" : "Reserve for pickup"}
        </button>
      </div>
      <button onClick={addToPlan} className="mt-2 w-full h-11 rounded-full border border-slate-300 font-semibold text-sm">Add to my plan (multi-merchant cart)</button>
      {msg && <div className="mt-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">{msg}</div>}
      <div className="mt-2 text-xs text-slate-500">Submitting creates a pending reservation and temporary stock hold. The merchant must confirm; Furnivo takes no payment. Hold release depends on the operator's scheduled expiry job; coordinate payment arrangements directly with the merchant.</div>
    </div>
  );
}
