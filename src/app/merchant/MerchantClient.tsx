"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatNaira } from "@/lib/utils";
import { minorAmountToDecimalString, parseMajorAmountToMinor } from "@/lib/money";
import Link from "next/link";
import ThemeControl from "@/components/ThemeControl";
import BrandLogo from "@/components/BrandLogo";
import MerchantQrButton from "@/components/MerchantQrButton";
import { merchantLocationLabel } from "@/lib/location-label";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

type MerchantService = { id: string; name: string; description: string | null; price: number | null; durationMin: number | null; capacity: number; updatedAt: string };

const formatProductAmount = (amount: number | null | undefined, currencyCode?: string | null) => {
  const code = currencyCode || DEFAULT_MARKET_CODE;
  if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, code)) return `${code} amount not supported in this market; no conversion`;
  return amount === null || amount === undefined ? "Price unavailable" : formatNaira(amount);
};

export default function MerchantClient({ user, merchants, activeMerchant, reservations, serviceBookings: initialServiceBookings, services: initialServices, lowStock }: any) {
  const [active, setActive] = useState(activeMerchant);
  const [tab, setTab] = useState("overview");
  const [msg, setMsg] = useState("");
  const [products, setProducts] = useState(active.products || []);
  const [branches, setBranches] = useState(active.branches || []);
  const [reservs, setReservs] = useState(reservations);
  const [serviceBookings, setServiceBookings] = useState(initialServiceBookings || []);
  const [services, setServices] = useState<MerchantService[]>(initialServices || []);
  const [queued, setQueued] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const activeIdRef = useRef(active.id);
  const syncingRef = useRef(false);
  const canEditInventory = ["OWNER", "MANAGER", "INVENTORY_STAFF"].includes(active.userRole);
  const canManageReservations = ["OWNER", "MANAGER", "RESERVATION_STAFF"].includes(active.userRole);
  const canCustomize = ["OWNER", "MANAGER"].includes(active.userRole);
  const [lowStockProducts, setLowStockProducts] = useState(lowStock);

  const draftKey = (merchantId: string) => `live_pending_updates_v4:${user.id}:${merchantId}`;
  const iso = (value: any) => value ? new Date(value).toISOString() : undefined;
  const readDrafts = (merchantId: string) => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey(merchantId)) || "[]");
      return Array.isArray(value) ? value.slice(0, 100) : [];
    } catch { return []; }
  };
  const persistDrafts = (merchantId: string, next: any[]) => {
    if (next.length > 100) return false;
    try { localStorage.setItem(draftKey(merchantId), JSON.stringify(next)); }
    catch { return false; }
    if (merchantId === activeIdRef.current) setQueued(next);
    return true;
  };
  const upsertDraft = (merchantId: string, product: any, patch: any, conflict?: any) => {
    const drafts = readDrafts(merchantId);
    const existing = drafts.find((draft: any) => draft.productId === product.id);
    const nextDraft = {
      id: existing?.id || product.id,
      productId: product.id,
      productName: product.name,
      patch: { ...(existing?.patch || {}), ...patch },
      baseUpdatedAt: existing?.baseUpdatedAt || iso(product.updatedAt),
      conflict: conflict || existing?.conflict || null,
    };
    return persistDrafts(merchantId, [...drafts.filter((draft: any) => draft.productId !== product.id), nextDraft]);
  };

  async function syncDrafts(merchantId: string) {
    if (!navigator.onLine || syncingRef.current) return;
    const drafts = readDrafts(merchantId);
    if (!drafts.length) { if (merchantId === activeIdRef.current) setQueued([]); return; }
    syncingRef.current = true;
    setSyncing(true);
    const remaining: any[] = [];
    let synced = 0, conflicts = 0;
    try {
      for (const draft of drafts) {
        if (draft.conflict) { remaining.push(draft); continue; }
        try {
          const response = await fetch(`/api/merchant/products/${encodeURIComponent(draft.productId)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...draft.patch, ...(draft.baseUpdatedAt ? { expectedUpdatedAt: draft.baseUpdatedAt } : {}) }),
          });
          const data = await response.json().catch(() => ({}));
          if (response.ok && data.product) {
            setProducts((current: any[]) => current.map((product) => product.id === draft.productId ? data.product : product));
            synced++;
          } else if (response.status === 409) {
            if (data.product) setProducts((current: any[]) => current.map((product) => product.id === draft.productId ? { ...product, ...data.product } : product));
            remaining.push({ ...draft, conflict: data.product || null, conflictMessage: data.error || "Server data changed." });
            conflicts++;
          } else remaining.push({ ...draft, lastError: data.error || "Sync failed; retry when ready." });
        } catch { remaining.push(draft); }
      }
      const stored = persistDrafts(merchantId, remaining);
      if (!stored) setMsg("Server sync completed, but this browser could not update its pending-draft storage. Check server inventory before retrying.");
      else if (synced || conflicts) setMsg(`${synced ? `${synced} draft${synced === 1 ? "" : "s"} synced. ` : ""}${conflicts ? `${conflicts} conflict${conflicts === 1 ? "" : "s"} need your review; server values were kept.` : ""}`.trim());
    } finally { syncingRef.current = false; setSyncing(false); }
  }

  useEffect(() => {
    activeIdRef.current = active.id;
    const onOnline = () => { setIsOnline(true); void syncDrafts(active.id); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const initialiseTimer = window.setTimeout(() => {
      setQueued(readDrafts(active.id));
      if (navigator.onLine) void syncDrafts(active.id);
    }, 0);
    return () => {
      window.clearTimeout(initialiseTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [active.id, user.id]);

  const updateProduct = async (product: any, patch: any) => {
    const expectedUpdatedAt = iso(product.updatedAt);
    if (!navigator.onLine) {
      const saved = upsertDraft(active.id, product, patch);
      setMsg(saved ? `Draft for ${product.name} saved on this device as pending. Server stock is unchanged until sync succeeds.` : "This browser could not store the draft. The server record is unchanged; reconnect before retrying.");
      return;
    }
    try {
      const response = await fetch(`/api/merchant/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setProducts((current: any[]) => current.map((item) => item.id === product.id ? data.product : item));
        const cleared = persistDrafts(active.id, readDrafts(active.id).filter((draft: any) => draft.productId !== product.id));
        setMsg(cleared ? `${product.name} saved on the server.` : `${product.name} saved on the server, but the old local draft could not be cleared. Review and discard it after reconnecting.`);
      } else if (response.status === 409) {
        if (data.product) setProducts((current: any[]) => current.map((item) => item.id === product.id ? { ...item, ...data.product } : item));
        const saved = upsertDraft(active.id, product, patch, data.product || null);
        setMsg(saved ? "The server record changed. Your edit is kept as a pending draft; review the current value before applying it." : "The server record changed, but this browser could not store your edit. No draft was applied; review the current value and retry online.");
      } else setMsg(data.error || "Could not update the product. The server record is unchanged.");
    } catch {
      const saved = upsertDraft(active.id, product, patch);
      setMsg(saved ? "Connection failed. Your edit is kept as a pending draft and is not yet reflected as confirmed stock." : "Connection failed and this browser could not store the edit. The server record is unchanged.");
    }
  };

  const applyDraft = async (draft: any) => {
    if (!navigator.onLine) { setMsg("Reconnect before syncing this draft."); return; }
    let expectedUpdatedAt = draft.baseUpdatedAt;
    if (draft.conflict) {
      const confirmed = window.confirm(`The server has a newer record for ${draft.productName}. Apply your draft on top of the current server version? This will replace the changed field(s) with your draft.`);
      if (!confirmed) return;
      expectedUpdatedAt = iso(draft.conflict.updatedAt);
    }
    try {
      const response = await fetch(`/api/merchant/products/${encodeURIComponent(draft.productId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft.patch, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.product) {
        setProducts((current: any[]) => current.map((product) => product.id === draft.productId ? data.product : product));
        const cleared = persistDrafts(active.id, readDrafts(active.id).filter((item: any) => item.id !== draft.id));
        setMsg(cleared ? "Draft accepted by the server and inventory refreshed." : "Draft accepted by the server, but the local copy could not be cleared. Please discard the old pending row after checking server values.");
      } else if (response.status === 409) {
        const next = readDrafts(active.id).map((item: any) => item.id === draft.id ? { ...item, conflict: data.product || null, conflictMessage: data.error } : item);
        persistDrafts(active.id, next);
        if (data.product) setProducts((current: any[]) => current.map((product) => product.id === draft.productId ? { ...product, ...data.product } : product));
        setMsg("Another update arrived first. Review the current server value and try again.");
      } else setMsg(data.error || "Draft was not accepted; it remains pending.");
    } catch { setMsg("Couldn't reach the server; this draft remains pending."); }
  };

  const discardDraft = (draftId: string) => {
    const discarded = persistDrafts(active.id, readDrafts(active.id).filter((draft: any) => draft.id !== draftId));
    setMsg(discarded ? "Pending draft discarded from this device." : "Could not remove the local draft. Check browser storage settings and try again.");
  };

  const createProduct = async (event: any) => {
    event.preventDefault();
    if (!navigator.onLine) { setMsg("Adding a product requires a connection. Your form values remain on this page; nothing has been submitted."); return; }
    const form = new FormData(event.target);
    const body: any = Object.fromEntries(form.entries());
    body.merchantId = active.id;
    const priceMinor = parseMajorAmountToMinor(String(body.price || ""), 2);
    const stockValue = String(body.stockQuantity || "");
    const lowStockValue = String(body.lowStockThreshold || "5");
    if (priceMinor === null || priceMinor > 1_000_000_000n) { setMsg("Enter a valid NGN price with at most two decimal places. Nothing was submitted."); return; }
    if (!/^\d+$/.test(stockValue) || !/^\d+$/.test(lowStockValue)) { setMsg("Enter whole-number stock and low-stock quantities. Nothing was submitted."); return; }
    body.price = Number(priceMinor);
    body.stockQuantity = Number(stockValue);
    body.lowStockThreshold = Number(lowStockValue);
    try {
      const response = await fetch("/api/merchant/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) { setProducts((current: any[]) => [data.product, ...current]); event.target.reset(); setMsg("Product saved to inventory. Marketplace-channel publication still requires merchant approval and listing review."); }
      else setMsg(data.error || "Product was not added.");
    } catch { setMsg("Connection failed. The form remains here; the product was not added."); }
  };

  const createService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!navigator.onLine) { setMsg("Adding a service requires a connection. Nothing has been submitted."); return; }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) body[key] = String(value);
    body.merchantId = active.id;
    if (body.price === "") delete body.price;
    if (body.durationMin === "") delete body.durationMin;
    body.capacity = Number(body.capacity || 1);
    try {
      const response = await fetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(data.error || "Service was not added."); return; }
      setServices((current) => [data.service as MerchantService, ...current]);
      formElement.reset();
      setMsg("Service saved. Marketplace-channel publication requires merchant approval and listing review; appointment requests still require your confirmation.");
    } catch { setMsg("Connection failed. The service was not added; retry when online."); }
  };

  const reservationAction = async (id: string, action: string) => {
    try {
      const response = await fetch(`/api/reservations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) { setReservs((current: any[]) => current.map((reservation) => reservation.id === id ? { ...reservation, status: data.reservation.status } : reservation)); setMsg(`Reservation ${action}ed.`); }
      else setMsg(data.error || "Reservation was not changed.");
    } catch { setMsg("Connection failed. Reservation status was not changed."); }
  };

  const serviceBookingAction = async (id: string, action: string) => {
    try {
      const response = await fetch(`/api/service-bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(data.error || "Appointment was not changed."); return; }
      setServiceBookings((current: any[]) => current.map((booking) => booking.id === id ? { ...booking, status: data.booking.status } : booking));
      setMsg(`Appointment ${action}ed.`);
    } catch { setMsg("Connection failed. Appointment status was not changed."); }
  };

  const toggleStore = async () => {
    if (!canCustomize) { setMsg("Your role cannot change store status."); return; }
    const next = active.storeStatus === "OPEN" ? "CLOSED" : "OPEN";
    try {
      const response = await fetch(`/api/merchant/${active.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeStatus: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(data.error || "Store status could not be changed. The saved status is unchanged."); return; }
      setActive({ ...active, ...data.merchant });
      setMsg(`Store status saved as ${next.toLowerCase()}.`);
    } catch { setMsg("Connection failed. The store's saved status is unchanged."); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-[1200px] px-4 h-[64px] flex items-center gap-4 merchant-topbar">
          <Link href="/" className="flex items-center gap-2" aria-label="Live home">
            <BrandLogo variant="horizontal" width={330} height={100} className="live-header-logo live-header-logo-light" decorative />
            <BrandLogo variant="inverse" width={330} height={100} className="live-header-logo live-header-logo-dark" decorative />
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">Merchant</span>
          </Link>
          <select value={active.id} onChange={async e=>{
            const m=merchants.find((x:any)=>x.id===e.target.value);
            if(!m) return;
            activeIdRef.current = m.id;
            setQueued([]); setReservs([]); setServiceBookings([]); setServices([]); setProducts([]); setLowStockProducts([]);
            setActive(m);
            try {
              const [productResponse, reservationResponse, branchResponse, bookingResponse, serviceResponse] = await Promise.all([
                fetch(`/api/merchant/products?merchantId=${encodeURIComponent(m.id)}`, { cache:"no-store" }),
                ["OWNER", "MANAGER", "RESERVATION_STAFF"].includes(m.userRole)
                  ? fetch(`/api/merchant/${encodeURIComponent(m.id)}/reservations`, { cache:"no-store" })
                  : Promise.resolve(null),
                fetch(`/api/merchant/branches?merchantId=${encodeURIComponent(m.id)}`, { cache:"no-store" }),
                ["OWNER", "MANAGER", "RESERVATION_STAFF"].includes(m.userRole)
                  ? fetch(`/api/merchant/${encodeURIComponent(m.id)}/bookings`, { cache:"no-store" })
                  : Promise.resolve(null),
                fetch(`/api/services?merchantId=${encodeURIComponent(m.id)}`, { cache:"no-store" }),
              ]);
              const productData = await productResponse.json().catch(()=>({}));
              if(!productResponse.ok) throw new Error(productData.error || "Products could not be loaded.");
              const nextProducts = Array.isArray(productData.products) ? productData.products : [];
              setProducts(nextProducts);
              const branchData = await branchResponse.json().catch(()=>({}));
              if (!branchResponse.ok) throw new Error(branchData.error || "Branches could not be loaded.");
              setBranches(Array.isArray(branchData.branches) ? branchData.branches : []);
              setLowStockProducts(nextProducts.filter((p:any)=>p.availability==="LOW_STOCK" || p.stockQuantity-p.reservedQuantity<=p.lowStockThreshold).slice(0,5));
              const serviceData = await serviceResponse.json().catch(()=>({}));
              if (!serviceResponse.ok) throw new Error(serviceData.error || "Services could not be loaded.");
              setServices(Array.isArray(serviceData.services) ? serviceData.services : []);
              if(reservationResponse) {
                const reservationData = await reservationResponse.json().catch(()=>({}));
                if(reservationResponse.ok) setReservs(reservationData.reservations || []);
              }
              if(bookingResponse) {
                const bookingData = await bookingResponse.json().catch(()=>({}));
                if(!bookingResponse.ok) throw new Error(bookingData.error || "Appointments could not be loaded.");
                setServiceBookings(bookingData.bookings || []);
              }
            } catch(error) { setMsg(error instanceof Error ? error.message : "Merchant data could not be refreshed."); }
          }} className="ml-4 bg-slate-100 rounded-full px-4 py-2 text-sm font-semibold border border-slate-200 merchant-store-picker">
            {merchants.map((m:any)=> <option key={m.id} value={m.id}>{m.businessName} • {m.area}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2 merchant-topbar-actions">
            {canCustomize && <button onClick={toggleStore} className={`px-4 py-2 rounded-full text-sm font-semibold ${active.storeStatus==="OPEN"?"bg-emerald-500 text-white":"bg-red-500 text-white"}`}>{active.storeStatus==="OPEN"?"Store marked open • Close":"Store marked closed • Open"}</button>}
            <ThemeControl userId={user.id} initialTheme={user.theme} />
            <Link href="/" className="hidden md:inline-flex px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold">View as customer</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="flex gap-2 overflow-x-auto">
          {["overview", ...(canManageReservations ? ["reservations", "appointments"] : []), "products", "services", "profile"].map(t=>(
            <button key={t} type="button" aria-pressed={tab===t} onClick={()=>setTab(t)} className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${tab===t?"bg-live-black text-white":"bg-white border border-slate-200"}`}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
          ))}
          <Link href={`/merchant/insights?merchantId=${active.id}`} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-live-green-ink text-white">📊 Insights</Link>
          <Link href={`/merchant/bulk?merchantId=${active.id}`} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-white border border-slate-200">⬆ Bulk CSV</Link>
          <button type="button" onClick={()=>setTab("products")} disabled={!canEditInventory} title={!canEditInventory ? "Your role cannot add inventory" : undefined} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-emerald-700 text-white disabled:cursor-not-allowed disabled:opacity-50">Add product</button>
          <button type="button" onClick={()=>setTab("services")} disabled={!canCustomize} title={!canCustomize ? "Only owners and managers can add services" : undefined} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-emerald-700 text-white disabled:cursor-not-allowed disabled:opacity-50">Add service</button>
          <Link href={`/merchant/connect?merchantId=${active.id}`} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-white border border-slate-200">🔌 Branches · Team · Connect</Link>
          <Link href="/legal#SELLER_AGREEMENT" className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap bg-white border border-slate-200">Policies · seller agreement</Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="bg-white border border-slate-200 rounded-full px-3 py-2">Store hours, stock, and reservation acceptance are separate controls.</span>
          <span className="bg-white border border-slate-200 rounded-full px-3 py-2">Offline edits stay pending until the server accepts them.</span>
          {active.status === "APPROVED" ? <MerchantQrButton merchantId={active.id} businessName={active.businessName} /> : <span className="bg-white border border-slate-200 rounded-full px-3 py-2">Public profile QR is available after approval.</span>}
        </div>

        {msg && <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-2 text-sm">{msg}</div>}

        {tab==="overview" && (
          <div className="mt-6 grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="font-bold">Recent reservation snapshot</h3>
                {canManageReservations ? <>
                  <p className="mt-1 text-xs text-slate-500">Counts cover the 20 most recently loaded records, not a calendar-day total.</p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4"><div className="text-xs font-semibold uppercase text-amber-700">Pending</div><div className="text-2xl font-black">{reservs.filter((r:any)=>r.status==="PENDING").length}</div></div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4"><div className="text-xs font-semibold uppercase text-blue-700">Confirmed</div><div className="text-2xl font-black">{reservs.filter((r:any)=>r.status==="CONFIRMED").length}</div></div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4"><div className="text-xs font-semibold uppercase text-emerald-700">Ready</div><div className="text-2xl font-black">{reservs.filter((r:any)=>r.status==="READY_FOR_PICKUP").length}</div></div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>setTab("reservations")} className="flex-1 min-w-[140px] h-10 rounded-full bg-live-black text-white font-semibold text-sm">View reservations</button><button onClick={()=>setTab("appointments")} className="flex-1 min-w-[140px] h-10 rounded-full bg-white border border-slate-200 font-semibold text-sm">Appointments · {serviceBookings.filter((booking:any)=>booking.status==="REQUESTED").length} pending</button><button onClick={()=>setTab("products")} className="flex-1 min-w-[140px] h-10 rounded-full bg-white border border-slate-200 font-semibold text-sm">Update stock</button></div>
                </> : <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Reservation details are restricted to owners, managers, and reservation staff. Your role: {active.userRole || "read-only"}.</div>}
              </div>

              {canManageReservations && <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="font-bold">Recent reservations</h3>
                {reservs.length===0 ? <div className="text-sm text-slate-500 mt-2">No reservations yet.</div> : (
                  <div className="mt-3 space-y-3">
                    {reservs.slice(0,5).map((r:any)=>(
                      <div key={r.id} className="flex gap-3 bg-slate-50 rounded-xl p-3">
                        {r.product.imageUrl ? <img src={r.product.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover" /> : <div aria-hidden="true" className="h-12 w-12 shrink-0 rounded-xl bg-slate-100" />}
                        <div className="flex-1">
                          <div className="text-sm font-semibold">{r.product.name} ×{r.quantity}</div>
                          <div className="text-xs text-slate-500">Customer identity withheld • {r.code} • {r.status}</div>
                        </div>
                        <div className="text-sm font-bold">{formatProductAmount(r.totalAmount, r.product?.currency)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>}
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="font-bold">Store</h3>
                <div className="mt-2 text-sm"><b>{active.businessName}</b> • {active.area}</div>
                <div className="text-xs text-slate-500">{active.address}</div>
                <div className="mt-3 flex gap-2">
                  <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${active.verificationStatus==="VERIFIED"?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-amber-50 text-amber-700 border-amber-200"}`}>{active.verificationStatus}</span>
                  <span className="text-xs bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">{active.status}</span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <h3 className="font-bold text-amber-900">Low stock</h3>
                {lowStockProducts.length===0 ? <div className="text-sm text-amber-800 mt-2">All good — no low stock.</div> : (
                  <div className="mt-2 space-y-2">
                    {lowStockProducts.map((p:any)=>(
                      <div key={p.id} className="flex justify-between text-sm bg-white rounded-xl px-3 py-2">
                        <span>{p.name}</span><span className="font-bold text-right">{p.stockQuantity} recorded<br /><span className="text-xs font-normal text-slate-600">{p.reservedQuantity} reserved</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab==="reservations" && canManageReservations && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Reservations • {reservs.length}</h3>
            <div className="mt-4 space-y-3">
              {reservs.map((r:any)=>(
                <div key={r.id} className="border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-4">
                  {r.product.imageUrl ? <img src={r.product.imageUrl} alt="" className="w-20 h-20 rounded-xl object-cover" /> : <div aria-hidden="true" className="h-20 w-20 shrink-0 rounded-xl bg-slate-100" />}
                  <div className="flex-1">
                    <div className="font-bold">{r.product.name} • Qty {r.quantity}</div>
                    <div className="text-sm text-slate-600">Customer identity withheld • {r.code}</div>
                    <div className="text-xs text-slate-500">Branch: {r.branch ? `${r.branch.name} · ${merchantLocationLabel(r.branch)}` : "Legacy reservation — branch not recorded"}</div>
                    <div className="text-xs text-slate-500">Pickup window: {r.pickupWindow || "not provided"} • Expires {new Date(r.expiresAt).toLocaleString()} • <b>{r.status}</b></div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {r.status==="PENDING" && (
                      <>
                        <button onClick={()=>reservationAction(r.id,"confirm")} className="px-6 py-2 rounded-full bg-live-green-ink text-white font-semibold text-sm">Confirm</button>
                        <button onClick={()=>reservationAction(r.id,"reject")} className="px-6 py-2 rounded-full bg-white border border-slate-200 font-semibold text-sm">Reject</button>
                      </>
                    )}
                    {r.status==="CONFIRMED" && <button onClick={()=>reservationAction(r.id,"ready")} className="px-6 py-2 rounded-full bg-live-black text-white font-semibold text-sm">Mark ready</button>}
                    {r.status==="READY_FOR_PICKUP" && <button onClick={()=>reservationAction(r.id,"collect")} className="px-6 py-2 rounded-full bg-emerald-600 text-white font-semibold text-sm">Mark collected</button>}
                    <div className="text-sm font-black text-center">{formatProductAmount(r.totalAmount, r.product?.currency)}</div>
                  </div>
                </div>
              ))}
              {reservs.length===0 && <div className="text-sm text-slate-500">No reservations.</div>}
            </div>
          </div>
        )}

        {tab==="appointments" && canManageReservations && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold">Service appointments • {serviceBookings.length}</h3>
            <p className="mt-1 text-xs text-slate-500">Requests reserve capacity only after the service provider confirms. Status changes are recorded on the server.</p>
            <div className="mt-4 space-y-3">
              {serviceBookings.map((booking:any)=>(
                <div key={booking.id} className="rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{booking.service.name}</div>
                    <div className="text-sm text-slate-600">{new Date(booking.startTime).toLocaleString()} – {new Date(booking.endTime).toLocaleTimeString()}</div>
                    <div className="text-xs text-slate-500">Customer details withheld · {booking.status.replaceAll("_", " ")}{booking.priceSnapshot !== null ? ` · listed at ${formatNaira(booking.priceSnapshot)} when requested` : " · price not recorded"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {booking.status==="REQUESTED" && <><button onClick={()=>serviceBookingAction(booking.id,"confirm")} className="px-4 py-2 rounded-full bg-live-green-ink text-white text-sm font-semibold">Confirm</button><button onClick={()=>serviceBookingAction(booking.id,"reject")} className="px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold">Decline</button></>}
                    {booking.status==="CONFIRMED" && <><button onClick={()=>serviceBookingAction(booking.id,"complete")} className="px-4 py-2 rounded-full bg-live-black text-white text-sm font-semibold">Mark complete</button><button onClick={()=>serviceBookingAction(booking.id,"cancel")} className="px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-semibold">Cancel</button></>}
                  </div>
                </div>
              ))}
              {serviceBookings.length===0 && <p className="text-sm text-slate-500">No appointment requests are recorded for this business.</p>}
            </div>
          </div>
        )}

        {tab==="products" && (
          <div className="mt-6 grid min-w-0 grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="min-w-0 lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-bold">Products • {products.length}</h3>
              <div className="mt-4 space-y-3">
                {products.map((p:any)=>(
                  <div key={p.id} className="flex min-w-0 gap-3 border border-slate-200 rounded-xl p-3">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover" /> : <div aria-hidden="true" className="h-16 w-16 shrink-0 rounded-xl bg-slate-100" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.category} • {formatProductAmount(p.price, p.currency)} • {p.availability}</div>
                      <div className="text-xs text-slate-500">Stock branch: {branches.find((branch:any) => branch.id === p.branchId)?.name || (p.branchId ? "Branch location unavailable" : "Legacy inventory — branch not recorded")}{branches.find((branch:any) => branch.id === p.branchId) ? ` · ${merchantLocationLabel(branches.find((branch:any) => branch.id === p.branchId))}` : ""}</div>
                      {canEditInventory && <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={()=>{
                          const v=prompt("New stock quantity (whole number)", String(p.stockQuantity));
                          if(v!==null){
                            if(!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v)>1000000){ setMsg("Enter a whole stock quantity from 0 to 1,000,000. No change was submitted."); return; }
                            void updateProduct(p,{ stockQuantity: Number(v) });
                          }
                        }} className="px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold">Update stock: {p.stockQuantity}</button>
                        <button onClick={()=>{
                          const v=prompt("New price (NGN)", minorAmountToDecimalString(p.price, 2, true));
                          if(v!==null){
                            const kobo=parseMajorAmountToMinor(v.replace(/,/g,""), 2);
                            if(kobo === null || kobo > 1_000_000_000n){ setMsg("Enter a nonnegative NGN price with at most two decimal places within the product price limit. No change was submitted."); return; }
                            void updateProduct(p,{ price: Number(kobo) });
                          }
                        }} disabled={!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, p.currency || DEFAULT_MARKET_CODE)} title={!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, p.currency || DEFAULT_MARKET_CODE) ? "Price editing is unavailable for this currency in the active market." : undefined} className="px-3 py-1 rounded-full bg-white border border-slate-200 text-xs font-semibold disabled:opacity-50">Price {formatProductAmount(p.price, p.currency)}</button>
                      </div>}
                    </div>
                  </div>
                ))}
              </div>
              {queued.length > 0 && <section className="live-pending-drafts" aria-labelledby="pending-drafts-title">
                <div className="live-pending-drafts-head"><div><div className="live-eyebrow">{isOnline ? "Connected" : "Offline"} · Not yet applied</div><h3 id="pending-drafts-title">Pending inventory drafts · {queued.length}</h3><p>Server values remain authoritative until each draft is accepted.</p></div>
                  <button type="button" className="live-button" disabled={syncing || !isOnline} onClick={() => void syncDrafts(active.id)}>{syncing ? "Syncing…" : "Retry sync"}</button></div>
                {queued.map((draft:any)=><article key={draft.id} className="live-pending-draft-row">
                  <div><strong>{draft.productName}</strong><small>{draft.conflict ? "Conflict: server record changed" : "Pending sync"} · {Object.entries(draft.patch).map(([key,value]) => `${key}: ${String(value)}`).join(" · ")}</small>
                    {draft.conflict && <small>Current server record: {draft.conflict.stockQuantity} in stock · updated {new Date(draft.conflict.updatedAt).toLocaleString()}. {draft.conflictMessage || "No draft value was applied."}</small>}
                    {draft.lastError && <small>{draft.lastError}</small>}
                  </div>
                  <div className="live-pending-draft-actions"><button type="button" className="live-button" disabled={!isOnline} onClick={() => void applyDraft(draft)}>{draft.conflict ? "Review & apply" : "Retry"}</button><button type="button" className="live-button" onClick={() => discardDraft(draft.id)}>Discard</button></div>
                </article>)}
              </section>}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              {canEditInventory ? <><h3 className="font-bold">Add product</h3>
              <p className="text-xs text-slate-500">Update stock in under 30 seconds.</p>
              <form onSubmit={createProduct} className="mt-4 space-y-3">
                <input name="name" placeholder="Product name" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" required />
                <input name="category" placeholder="Category e.g. Pharmacy" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" required />
                <input name="brand" placeholder="Brand (optional)" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input name="price" placeholder="Price NGN e.g. 1200" type="number" className="h-10 px-3 rounded-xl border border-slate-200 text-sm" required />
                  <input name="stockQuantity" placeholder="Stock qty" type="number" className="h-10 px-3 rounded-xl border border-slate-200 text-sm" required />
                </div>
                {branches.length > 0 ? <div><label className="text-xs font-semibold uppercase text-slate-500" htmlFor="product-branch">Stock branch</label><select id="product-branch" name="branchId" required defaultValue="" className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 text-sm"><option value="">Choose the branch that owns this stock</option>{branches.map((branch:any) => <option key={branch.id} value={branch.id}>{branch.name} · {merchantLocationLabel(branch)}</option>)}</select><small className="mt-1 block text-xs text-slate-500">Stock quantity is stored for this branch only; it is not combined across locations.</small></div> : <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">No branch record exists yet. <Link className="font-bold underline" href={`/merchant/connect?merchantId=${encodeURIComponent(active.id)}`}>Create a branch</Link> before adding stock; Live will not assign inventory to an unknown location.</p>}
                <input name="lowStockThreshold" placeholder="Low stock threshold 5" type="number" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" />
                <input name="imageUrl" placeholder="Image URL (optional)" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" />
                <input name="sku" placeholder="SKU optional" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm" />
                <button disabled={branches.length === 0} className="w-full h-10 rounded-full bg-live-green-ink text-white font-semibold text-sm disabled:opacity-50">Add product to selected branch</button>
              </form>
              <div className="mt-4 p-3 bg-slate-50 rounded-xl text-xs text-slate-600">
                If offline, stock and price edits are stored as clearly pending drafts on this device. They sync after reconnecting only if the server record has not changed; conflicts require your review.
              </div></> : <div className="text-sm text-slate-600"><h3 className="font-bold text-slate-900">Inventory access</h3><p className="mt-2">Your role ({active.userRole || "read-only"}) can view this catalogue but cannot change stock or prices.</p></div>}
            </div>
          </div>
        )}

        {tab==="services" && (
          <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2" aria-labelledby="merchant-services-title">
              <h3 id="merchant-services-title" className="font-bold">Services · {services.length}</h3>
              <p className="mt-1 text-xs text-slate-500">Service appointments are separate from product reservations. An appointment request is not accepted until you confirm it.</p>
              <div className="mt-4 space-y-3">
                {services.map((service) => <article key={service.id} className="rounded-xl border border-slate-200 p-4">
                  <h4 className="font-semibold">{service.name}</h4>
                  {service.description && <p className="mt-1 text-sm text-slate-600">{service.description}</p>}
                  <p className="mt-2 text-sm font-semibold">{service.price === null ? "Price on request" : formatNaira(service.price)}{service.durationMin ? ` · ${service.durationMin} minutes` : ""} · capacity ${service.capacity}</p>
                  <p className="mt-1 text-xs text-slate-500">Updated {new Date(service.updatedAt).toLocaleString()} · edits are not yet available in this workspace.</p>
                </article>)}
                {services.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">No services are recorded for this business yet.</div>}
              </div>
            </section>
            <aside className="rounded-2xl border border-slate-200 bg-white p-5">
              {canCustomize ? <>
                <h3 className="font-bold">Add a service</h3>
                <p className="mt-1 text-xs text-slate-500">Use an appointment workflow with an optional fixed price or a quote request.</p>
                <form onSubmit={createService} className="mt-4 space-y-3">
                  <div><label htmlFor="service-name" className="text-xs font-semibold uppercase text-slate-500">Service name</label><input id="service-name" name="name" required minLength={2} maxLength={120} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></div>
                  <div><label htmlFor="service-description" className="text-xs font-semibold uppercase text-slate-500">Description</label><textarea id="service-description" name="description" maxLength={2000} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" /></div>
                  <div><label htmlFor="service-price" className="text-xs font-semibold uppercase text-slate-500">Price in NGN · optional</label><input id="service-price" name="price" type="number" min="0" max="10000000" step="0.01" placeholder="Leave blank for a quote" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label htmlFor="service-duration" className="text-xs font-semibold uppercase text-slate-500">Minutes · optional</label><input id="service-duration" name="durationMin" type="number" min="5" max="1440" step="1" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></div>
                    <div><label htmlFor="service-capacity" className="text-xs font-semibold uppercase text-slate-500">Capacity</label><input id="service-capacity" name="capacity" type="number" min="1" max="100" step="1" defaultValue="1" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></div>
                  </div>
                  <button className="h-11 w-full rounded-full bg-live-green-ink font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Save service</button>
                </form>
                <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Saving creates a service listing linked to your merchant record. Public visibility depends on merchant approval and marketplace readiness. No payment, escrow, or automated provider confirmation is enabled.</p>
              </> : <div className="text-sm text-slate-600"><h3 className="font-bold text-slate-900">Service access</h3><p className="mt-2">Only owners and managers can add services. Your role ({active.userRole || "read-only"}) can view service records for this business.</p></div>}
            </aside>
          </div>
        )}

        {tab==="profile" && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6">
            <h3 className="font-bold">Business profile</h3>
            <div className="mt-3 grid md:grid-cols-2 gap-4 text-sm">
              <div><b>Business</b><div className="text-slate-600">{active.businessName}</div></div>
              <div><b>Category</b><div className="text-slate-600">{active.category}</div></div>
              <div><b>Location</b><div className="text-slate-600">{[active.cityArea?.name || active.city, active.lga?.name || active.area, active.state?.name].filter(Boolean).join(" · ") || "Location not coded"}</div></div>
              <div><b>Address</b><div className="text-slate-600">{active.address}</div></div>
              <div><b>Phone</b><div className="text-slate-600">{active.phone}</div></div>
              <div><b>Status</b><div className="text-slate-600">{active.status} • {active.verificationStatus}</div></div>
            </div>
            <p className="mt-4 text-xs text-slate-600">Use Branches · Team · Connect for supported storefront settings. Business name and address changes require admin review; this panel does not submit an edit.</p>
          </div>
        )}
      </div>
    </div>
  );
}
