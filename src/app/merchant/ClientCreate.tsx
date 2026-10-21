"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MerchantGeographyFields from "@/components/MerchantGeographyFields";

export default function ClientCreate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, any> = Object.fromEntries(formData.entries());
    body.pickupAvailable = formData.has("pickupAvailable");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/merchant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Store could not be created.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Store could not be created. Check your connection and try again.");
    } finally { setLoading(false); }
  };

  return <form onSubmit={submit} className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
    <div className="grid md:grid-cols-2 gap-4">
      <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="businessName">Business name</label><input id="businessName" name="businessName" placeholder="My Pharmacy" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" required maxLength={120} /></div>
      <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="category">Category</label><select id="category" name="category" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" required><option value="PHARMACY">Pharmacy</option><option value="SUPERMARKET">Supermarket</option><option value="PROVISIONS">Provisions</option><option value="CHEMIST">Chemist</option></select></div>
      <div className="md:col-span-2"><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="description">Description (optional)</label><input id="description" name="description" placeholder="What does this business sell or offer?" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" maxLength={1000} /></div>
      <div className="md:col-span-2"><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="address">Public business address or landmark</label><input id="address" name="address" placeholder="Shop / street or public landmark" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" required maxLength={240} /><small className="mt-1 block text-xs text-slate-500">This address will be visible on the merchant profile. Do not enter a private home address unless it is also the public business location.</small></div>
      <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="phone">Business phone</label><input id="phone" name="phone" placeholder="+234…" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" required maxLength={32} /></div>
      <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="email">Business email (optional)</label><input id="email" name="email" type="email" placeholder="store@example.ng" className="mt-1 w-full h-11 px-4 rounded-xl border border-slate-200" maxLength={254} /></div>
    </div>
    <MerchantGeographyFields />
    <fieldset className="grid sm:grid-cols-2 gap-3 text-sm">
      <legend className="text-xs font-semibold uppercase text-slate-500">Fulfilment you genuinely offer</legend>
      <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3"><input type="checkbox" name="pickupAvailable" className="mt-1" /><span><strong>Pickup</strong><small className="block text-xs text-slate-500">Customers can collect from this business.</small></span></label>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2">Delivery integrations are not configured. Live does not verify or arrange delivery; customers should confirm any seller-managed arrangement directly with the business.</p>
    </fieldset>
    <p className="text-xs text-slate-500">New businesses are pending review. Selecting a location is not independent verification; stock and merchant coverage are not assumed.</p>
    {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    <button disabled={loading} className="w-full min-h-11 rounded-full bg-live-black text-white font-semibold disabled:opacity-50">{loading ? "Creating store…" : "Create store for review"}</button>
  </form>;
}
