"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, BellOff, Bookmark, Clock3, ListChecks, Pencil, RotateCw, Trash2 } from "lucide-react";
import { formatNaira } from "@/lib/utils";
import ImageWithFallback from "@/components/ImageWithFallback";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

type Props = { savedItems: any[]; savedSearches: any[]; priceAlerts: any[]; recentViews: any[]; reservations: any[]; lists: any[] };
const naira = (kobo: number | string) => formatNaira(kobo);
const reservationMoney = (amount: number, currencyCode?: string | null) => {
  const code = currencyCode || "UNRECORDED";
  return getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, code)
    ? naira(amount)
    : `${code} minor units; transaction currency is not recorded`;
};
function savedSearchHref(item: any) {
  const params = new URLSearchParams({ q: item.query });
  try {
    const filters = JSON.parse(item.filters || "{}");
    for (const key of ["area", "category", "minPrice", "maxPrice", "sort", "inStock", "openNow", "pickup", "delivery", "verified"]) {
      if (filters?.[key] !== undefined && filters?.[key] !== null && filters?.[key] !== "") params.set(key, String(filters[key]));
    }
  } catch { /* query-only fallback */ }
  return `/search?${params.toString()}`;
}

export default function MyLiveClient(initial: Props) {
  const [savedItems, setSavedItems] = useState(initial.savedItems);
  const [savedSearches, setSavedSearches] = useState(initial.savedSearches);
  const [priceAlerts, setPriceAlerts] = useState(initial.priceAlerts);
  const [recentViews, setRecentViews] = useState(initial.recentViews);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState("");
  const [editForm, setEditForm] = useState({ label: "", query: "", alertFrequency: "DAILY" });

  const activeReservations = useMemo(() => initial.reservations.filter((reservation) => ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"].includes(reservation.status)), [initial.reservations]);

  const removeSaved = async (productId: string) => {
    setBusy(`saved:${productId}`); setMessage("");
    try {
      const response = await fetch(`/api/saved?productId=${encodeURIComponent(productId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not remove saved item");
      setSavedItems((items) => items.filter((item) => item.productId !== productId));
      setMessage("Saved item removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove saved item."); }
    finally { setBusy(""); }
  };

  const beginEdit = (search: any) => {
    setEditing(search.id);
    setEditForm({ label: search.label || "", query: search.query, alertFrequency: search.alertFrequency || "DAILY" });
  };

  const saveSearch = async (id: string, patch: Record<string, unknown>) => {
    setBusy(`search:${id}`); setMessage("");
    try {
      const response = await fetch("/api/saved-searches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update search");
      setSavedSearches((items) => items.map((item) => item.id === id ? data.savedSearch : item));
      setEditing(""); setMessage("Saved search updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update search."); }
    finally { setBusy(""); }
  };

  const deleteSearch = async (id: string) => {
    setBusy(`search:${id}`); setMessage("");
    try {
      const response = await fetch(`/api/saved-searches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete search");
      setSavedSearches((items) => items.filter((item) => item.id !== id)); setMessage("Saved search deleted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete search."); }
    finally { setBusy(""); }
  };

  const removeAlert = async (id: string) => {
    setBusy(`alert:${id}`); setMessage("");
    try {
      const response = await fetch("/api/price-alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not turn off alert");
      setPriceAlerts((items) => items.filter((item) => item.id !== id)); setMessage("Price alert turned off.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not turn off alert."); }
    finally { setBusy(""); }
  };

  const clearRecent = async () => {
    if (!window.confirm("Clear your recently viewed product history from your account?")) return;
    setBusy("recent"); setMessage("");
    try {
      const response = await fetch("/api/recent-views", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear recent views");
      setRecentViews([]); setMessage("Recently viewed history cleared.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not clear history."); }
    finally { setBusy(""); }
  };

  return <div className="live-my-live-content">
    {message && <div className="live-inline-notice" role="status" aria-live="polite"><span>{message}</span><button type="button" onClick={() => setMessage("")}>Dismiss</button></div>}

    <section className="live-my-live-section" aria-labelledby="saved-searches-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow"><Bookmark size={13} /> Discover again</div><h2 id="saved-searches-heading" className="live-section-title">Saved searches</h2></div><Link href="/search" className="live-text-link">New search <ArrowRight size={15} /></Link></div>
      {savedSearches.length ? <div className="live-my-live-grid">{savedSearches.map((search: any) => <article key={search.id} className="live-memory-card">
        <div className="live-memory-card-top"><span className={`live-alert-indicator ${search.alertEnabled ? "is-on" : ""}`}>{search.alertEnabled ? <Bell size={14} /> : <BellOff size={14} />}{search.alertEnabled ? `${search.alertFrequency.toLowerCase()} alert` : "Alerts paused"}</span><button type="button" className="live-icon-button-sm" aria-label={`Edit ${search.label || search.query}`} onClick={() => beginEdit(search)}><Pencil size={15} /></button></div>
        <Link href={savedSearchHref(search)} className="live-memory-title">{search.label || search.query}</Link>
        {search.label && <p className="live-memory-subtitle">{search.query}</p>}
        <div className="live-memory-actions"><Link href={savedSearchHref(search)} className="live-button">Open search <ArrowRight size={14} /></Link><button type="button" className="live-button" disabled={busy === `search:${search.id}`} onClick={() => void saveSearch(search.id, { alertEnabled: !search.alertEnabled })}>{search.alertEnabled ? "Pause alert" : "Enable alert"}</button><button type="button" aria-label="Delete saved search" className="live-icon-button-sm danger" disabled={busy === `search:${search.id}`} onClick={() => void deleteSearch(search.id)}><Trash2 size={15} /></button></div>
        {editing === search.id && <form className="live-edit-search" onSubmit={(event) => { event.preventDefault(); void saveSearch(search.id, { label: editForm.label, query: editForm.query, alertFrequency: editForm.alertFrequency }); }}>
          <label>Search name<input className="live-field" value={editForm.label} maxLength={60} onChange={(event) => setEditForm({ ...editForm, label: event.target.value })} placeholder="Optional label" /></label>
          <label>Search terms<input className="live-field" value={editForm.query} maxLength={120} onChange={(event) => setEditForm({ ...editForm, query: event.target.value })} required /></label>
          <label>In-app alert frequency<select className="live-field" value={editForm.alertFrequency} onChange={(event) => setEditForm({ ...editForm, alertFrequency: event.target.value })}><option value="INSTANT">As soon as the scheduler checks</option><option value="DAILY">Daily grouped check</option><option value="WEEKLY">Weekly grouped check</option></select></label>
          <div className="live-edit-actions"><button className="live-button live-button-primary" disabled={busy === `search:${search.id}`}>Save changes</button><button type="button" className="live-button" onClick={() => setEditing("")}>Cancel</button></div>
        </form>}
      </article>)}</div> : <div className="live-empty-card"><strong>No saved searches.</strong><p>Save search terms and filters while signed in. They are available across your signed-in devices.</p><Link href="/search" className="live-button">Start searching</Link></div>}
      {savedSearches.some((search: any) => search.alertEnabled) && <p className="live-caveat">Saved-search alerts are in-app only. They require a configured scheduler to run `/api/jobs/process` with `CRON_SECRET`; push and email delivery are not configured.</p>}
    </section>

    <section className="live-my-live-section" aria-labelledby="saved-products-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow">Real listings, saved for later</div><h2 id="saved-products-heading" className="live-section-title">Saved products</h2></div><Link href="/saved" className="live-text-link">Open saved items <ArrowRight size={15} /></Link></div>
      {savedItems.filter((item: any) => item.product).length ? <div className="live-memory-list">{savedItems.filter((item: any) => item.product).map((item: any) => <article className="live-saved-item" key={item.id}>
        <Link href={`/product/${item.product.id}`} className="live-saved-item-link"><ImageWithFallback src={item.product.imageUrl} alt={item.product.imageUrl ? item.product.name : ""} className="live-saved-image" /><span><strong>{item.product.name}</strong><small>{item.product.merchant.businessName} · {item.product.merchant.area}</small><b>{naira(item.product.price)}</b><small>Availability must be rechecked before acting.</small></span></Link>
        <button type="button" className="live-icon-button-sm danger" disabled={busy === `saved:${item.productId}`} aria-label={`Remove ${item.product.name} from saved items`} onClick={() => void removeSaved(item.productId)}><Trash2 size={15} /></button>
      </article>)}</div> : <div className="live-empty-card"><strong>No saved products.</strong><p>Use Save on a product detail page; it does not reserve stock.</p><Link href="/search" className="live-button">Browse listings</Link></div>}
    </section>

    <section className="live-my-live-section" aria-labelledby="price-alerts-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow"><Bell size={13} /> Listing price checks</div><h2 id="price-alerts-heading" className="live-section-title">Price alerts</h2></div></div>
      {priceAlerts.length ? <div className="live-my-live-grid">{priceAlerts.map((alert: any) => <article className="live-memory-card" key={alert.id}>
        <strong className="live-memory-title">{alert.product?.name || alert.query || "Search price target"}</strong>
        <p className="live-memory-subtitle">Target: {naira(alert.thresholdKobo)}{alert.product ? ` · current listed price: ${naira(alert.product.price)}` : " · search target; no current product price attached"}</p>
        <p className="live-memory-subtitle">{alert.lastTriggeredAt ? `Last triggered ${new Date(alert.lastTriggeredAt).toLocaleString()}` : "No trigger recorded"}. Trigger checks use recorded merchant prices only.</p>
        <div className="live-memory-actions">{alert.product && <Link className="live-button" href={`/product/${alert.product.id}`}>View listing <ArrowRight size={14} /></Link>}<button type="button" className="live-button" disabled={busy === `alert:${alert.id}`} onClick={() => void removeAlert(alert.id)}>Turn off</button></div>
      </article>)}</div> : <div className="live-empty-card"><strong>No active price alerts.</strong><p>Alerts are evaluated against current recorded merchant listings. They do not create historical prices.</p><Link href="/search" className="live-button">Find a product</Link></div>}
      {priceAlerts.length > 0 && <p className="live-caveat">In-app triggers run only when the scheduled job runner is configured with `CRON_SECRET`. Email and push delivery are not active.</p>}
    </section>

    <section className="live-my-live-section" aria-labelledby="recent-views-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow"><Clock3 size={13} /> Synced to your account</div><h2 id="recent-views-heading" className="live-section-title">Recently viewed</h2></div><button type="button" className="live-button" disabled={!recentViews.length || busy === "recent"} onClick={() => void clearRecent()}><Trash2 size={14} /> Clear history</button></div>
      {recentViews.length ? <div className="live-recent-list">{recentViews.map((view: any) => <Link key={view.id} href={`/product/${view.product.id}`} className="live-recent-list-item"><ImageWithFallback src={view.product.imageUrl} alt={view.product.imageUrl ? view.product.name : ""} className="live-saved-image" /><span><strong>{view.product.name}</strong><small>{view.product.merchant.businessName} · {view.product.merchant.area}</small><small>Viewed {new Date(view.viewedAt).toLocaleString()}</small></span><ArrowRight size={16} /></Link>)}</div> : <div className="live-empty-card"><strong>No recent product views.</strong><p>Signed-in product pages you open are saved to your account so you can continue on another device.</p><Link href="/search" className="live-button">Search products</Link></div>}
    </section>

    <section className="live-my-live-section" aria-labelledby="lists-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow"><ListChecks size={13} /> Planning</div><h2 id="lists-heading" className="live-section-title">Shopping lists</h2></div><Link href="/lists" className="live-text-link">Create or share a list <ArrowRight size={15} /></Link></div>
      {initial.lists.length ? <div className="live-my-live-grid">{initial.lists.map((list: any) => <Link key={list.id} href={`/lists/${list.id}`} className="live-memory-card"><span className="live-personal-icon"><ListChecks size={18} /></span><strong className="live-memory-title">{list.name}</strong><span className="live-memory-subtitle">{list._count?.items ?? 0} items · {list.isOwner ? "Your list" : "Shared list"}</span><span className="live-button">Open list <ArrowRight size={14} /></span></Link>)}</div> : <div className="live-empty-card"><strong>No lists yet.</strong><p>Shared lists are plans; every product and reservation remains separate by merchant.</p><Link href="/lists" className="live-button">Create a list</Link></div>}
    </section>

    <section className="live-my-live-section" aria-labelledby="reservations-heading">
      <div className="live-section-heading"><div><div className="live-eyebrow">Server-confirmed activity</div><h2 id="reservations-heading" className="live-section-title">Reservations</h2></div><Link href="/activity" className="live-text-link">Full activity <ArrowRight size={15} /></Link></div>
      {activeReservations.length ? <div className="live-reservation-list">{activeReservations.map((reservation: any) => <Link key={reservation.id} href="/activity" className="live-reservation-row"><span className={`live-status-pill ${reservation.status === "READY_FOR_PICKUP" ? "is-open" : "is-pending"}`}>{reservation.status.replaceAll("_", " ")}</span><span><strong>{reservation.product.name}</strong><small>{reservation.merchant.businessName} · Code {reservation.code}</small></span><b>{reservationMoney(reservation.totalAmount, reservation.product?.currency)}</b><ArrowRight size={16} /></Link>)}</div> : <div className="live-empty-card"><strong>No active reservations.</strong><p>A cart or saved listing is not a confirmed order. New reservations appear here after the server accepts them.</p><Link href="/search" className="live-button">Find availability</Link></div>}
    </section>
  </div>;
}
