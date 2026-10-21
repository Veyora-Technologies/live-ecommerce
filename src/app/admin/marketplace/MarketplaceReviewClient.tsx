"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatNaira } from "@/lib/utils";

type ReviewListing = {
  id: string;
  listingKind: string;
  title: string;
  description: string | null;
  priceModel: string;
  priceAmountMinor: string | null;
  currencyCode: string;
  priceUnit: string | null;
  createdAt: string;
  sellerAgreementAccepted: boolean;
  category: { slug: string; name: string };
  merchant: { id: string; businessName: string; status: string; area: string; city: string; stateCode: string | null } | null;
  media: { url: string; altText: string | null }[];
  product: { id: string; name: string; category: string; brand: string | null; archived: boolean; merchant: { status: string } } | null;
  service: { id: string; name: string; durationMin: number | null; capacity: number; merchant: { status: string } } | null;
};
type CategoryReadiness = {
  id: string;
  slug: string;
  name: string;
  listingKind: string;
  workflowKey: string;
  readinessStatus: string;
  enabledForNewListings: boolean;
  visibleInSearch: boolean;
  requiresReview: boolean;
  requiresSellerVerification: boolean;
  schemaVersion: number;
  parent: { name: string; slug: string } | null;
};

export default function MarketplaceReviewClient() {
  const [rows, setRows] = useState<ReviewListing[]>([]);
  const [categories, setCategories] = useState<CategoryReadiness[]>([]);
  const [categoryError, setCategoryError] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/marketplace/listings", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Marketplace review queue could not be loaded.");
      setRows(Array.isArray(data.listings) ? data.listings : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Marketplace review queue could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoryError("");
    try {
      const response = await fetch("/api/admin/marketplace/categories", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Category readiness could not be loaded.");
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (cause) {
      setCategoryError(cause instanceof Error ? cause.message : "Category readiness could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); void loadCategories(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loadCategories]);

  const decide = async (listing: ReviewListing, action: "approve" | "reject") => {
    const reason = (reasons[listing.id] || "").trim();
    if (action === "reject" && reason.length < 2) { setError("Enter a rejection reason of at least 2 characters."); return; }
    setBusy(listing.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/marketplace/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listing.id, action, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Review decision was not saved.");
      setRows((current) => current.filter((row) => row.id !== listing.id));
      setReasons((current) => { const next = { ...current }; delete next[listing.id]; return next; });
      setMessage(action === "approve" ? "Listing approved and published. No payment or verification claim was created." : "Listing rejected; the reason was recorded in the review audit trail.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review decision was not saved.");
    } finally { setBusy(null); }
  };

  return <div className="mx-auto max-w-[1100px] px-4 py-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Administration · controlled release</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Marketplace listing review</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">Review submitted product and service projections. Approval makes a listing searchable; it does not verify identity, stock, professional authorization, title, safety, or other seller claims.</p>
      </div>
      <Link href="/admin" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Admin home</Link>
    </div>

    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      Marketplace publishing is not a payment or transaction-protection service. Product reservations and service appointments continue to use their separate existing workflows. Seller appeals and advanced risk-review tools are not part of this queue yet.
    </div>
    <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-slate-900">Category readiness · {categories.length} configured records</summary>
      <p className="mt-2 text-xs text-slate-600">The code-backed workflow registry, moderation and verification controls must also pass before a category can be surfaced. This read-only panel does not activate categories.</p>
      {categoryError && <p role="alert" className="mt-2 text-sm text-red-800">{categoryError}</p>}
      <div className="mt-3 space-y-2">
        {categories.map((category) => <div key={category.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm md:flex-row md:items-center md:justify-between">
          <div><strong>{category.name}</strong><span className="ml-2 text-xs text-slate-500">{category.slug}{category.parent ? ` · under ${category.parent.name}` : ""} · {category.listingKind}</span><div className="mt-1 text-xs text-slate-500">Workflow {category.workflowKey} · schema v{category.schemaVersion} · moderation review {category.requiresReview ? "required" : "not configured"} · independent seller verification {category.requiresSellerVerification ? "required" : "not required"}</div></div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${category.readinessStatus === "READY" && category.enabledForNewListings && category.visibleInSearch ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{category.readinessStatus} · {category.enabledForNewListings ? "new listings on" : "new listings off"} · {category.visibleInSearch ? "search on" : "search off"}</span>
        </div>)}
        {!categoryError && categories.length === 0 && <p className="text-sm text-slate-500">No marketplace categories are seeded in this database.</p>}
      </div>
    </details>
    {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

    <section aria-label="Listings awaiting review" aria-live="polite" className="mt-5 space-y-3">
      {loading && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading review queue…</div>}
      {!loading && rows.length === 0 && !error && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="font-bold">No listings are awaiting review</h2><p className="mt-2 text-sm text-slate-600">This is based on current records; it does not indicate marketplace volume or coverage.</p></div>}
      {rows.map((listing) => {
        const sellerApproved = listing.merchant?.status === "APPROVED";
        const activeProduct = !listing.product || (!listing.product.archived && listing.product.merchant.status === "APPROVED");
        const canApprove = sellerApproved && activeProduct && listing.sellerAgreementAccepted && Boolean(listing.product || listing.service);
        const price = listing.priceAmountMinor === null ? "Price on request" : listing.currencyCode === "NGN" ? formatNaira(listing.priceAmountMinor) : `${listing.currencyCode} ${listing.priceAmountMinor} minor units`;
        return <article key={listing.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row">
            {listing.media[0]?.url && <Image src={listing.media[0].url} alt={listing.media[0].altText || ""} width={560} height={360} unoptimized className="h-28 w-full rounded-xl object-cover md:w-36" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">{listing.category.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{listing.listingKind}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${sellerApproved ? "bg-blue-50 text-blue-900" : "bg-amber-100 text-amber-900"}`}>Merchant: {listing.merchant?.status || "unavailable"}</span>
              </div>
              <h2 className="mt-2 text-lg font-bold text-slate-950">{listing.title}</h2>
              {listing.merchant && <p className="mt-1 text-sm text-slate-700">{listing.merchant.businessName} · {[listing.merchant.area, listing.merchant.city, listing.merchant.stateCode].filter(Boolean).join(", ")}</p>}
              {listing.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{listing.description}</p>}
              <p className="mt-2 text-sm font-semibold text-slate-900">{price}{listing.priceUnit ? ` · ${listing.priceUnit}` : ""} · {listing.priceModel}</p>
              {listing.product && <p className="mt-1 text-xs text-slate-500">Product category: {listing.product.category} · {listing.product.brand || "No brand recorded"}</p>}
              {listing.service && <p className="mt-1 text-xs text-slate-500">Service duration: {listing.service.durationMin ? `${listing.service.durationMin} minutes` : "not specified"} · capacity {listing.service.capacity}</p>}
              <p className="mt-1 text-xs text-slate-500">Submitted {new Date(listing.createdAt).toLocaleString()}</p>
            </div>
          </div>
          {!canApprove && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Approval is unavailable until the merchant is platform-approved, the linked source record is active, and (in production) the owner has accepted the current seller agreement. Seller agreement status: {listing.sellerAgreementAccepted ? "recorded" : "not recorded"}.</p>}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <label htmlFor={`review-reason-${listing.id}`} className="text-xs font-semibold uppercase text-slate-500">Review note · required for rejection</label>
            <textarea id={`review-reason-${listing.id}`} value={reasons[listing.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [listing.id]: event.target.value.slice(0, 500) }))} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Record a specific, actionable reason; do not treat a report or signal as proof." />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!canApprove || busy === listing.id} onClick={() => void decide(listing, "approve")} className="min-h-10 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === listing.id ? "Saving…" : "Approve and publish"}</button>
              <button type="button" disabled={busy === listing.id} onClick={() => void decide(listing, "reject")} className="min-h-10 rounded-full border border-red-300 bg-white px-5 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-50">Reject with reason</button>
            </div>
          </div>
        </article>;
      })}
    </section>
  </div>;
}
