"use client";
import { useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/utils";
import { merchantLocationLabel } from "@/lib/location-label";
import { notificationCategory } from "@/lib/notification-category";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const statusColor: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  REQUESTED: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COLLECTED: "bg-slate-900 text-white border-slate-900",
  COMPLETED: "bg-slate-900 text-white border-slate-900",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-200",
  EXPIRED: "bg-slate-100 text-slate-500 border-slate-200",
  OPEN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  RESPONDED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-slate-900 text-white border-slate-900",
};
const tabs = ["All activity", "Reservations", "Appointments", "Requests & quotes", "Notifications"] as const;
const reservationMoney = (amount: number, currencyCode?: string | null) => {
  const code = currencyCode || "UNRECORDED";
  return getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, code)
    ? formatNaira(amount)
    : `${code} minor units; transaction currency is not recorded`;
};

export default function ActivityClient({ reservations, bookings, requests, notifications, initialTab }: { reservations: any[]; bookings: any[]; requests: any[]; notifications: any[]; initialTab?: string }) {
  const [reservationList, setReservationList] = useState(reservations);
  const [bookingList, setBookingList] = useState(bookings);
  const [requestList] = useState(requests);
  const [notificationList, setNotificationList] = useState(notifications);
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs.includes(initialTab as (typeof tabs)[number]) ? initialTab as (typeof tabs)[number] : "All activity");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [category, setCategory] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const actReservation = async (id: string, action: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/reservations/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(data.error || "Reservation was not changed."); return; }
      setReservationList((current) => current.map((item) => item.id === id ? { ...item, status: data.reservation.status } : item));
      setNotice("Reservation status updated.");
    } catch { setNotice("Connection failed. Reservation status was not changed."); }
    finally { setBusy(""); }
  };

  const actBooking = async (id: string, action: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/service-bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(data.error || "Appointment was not changed."); return; }
      setBookingList((current) => current.map((item) => item.id === id ? { ...item, status: data.booking.status } : item));
      setNotice("Appointment status updated.");
    } catch { setNotice("Connection failed. Appointment status was not changed."); }
    finally { setBusy(""); }
  };

  const markNotification = async (id: string, read: boolean) => {
    setBusy(id);
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, read }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(data.error || "Notification state was not changed."); return; }
      setNotificationList((current) => current.map((item) => item.id === id ? { ...item, read } : item));
      setNotice(read ? "Notification marked read." : "Notification marked unread.");
    } catch { setNotice("Connection failed. Notification state was not changed."); }
    finally { setBusy(""); }
  };

  const markAllRead = async () => {
    setBusy("all-notifications");
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllRead: true }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(data.error || "Notifications were not updated."); return; }
      setNotificationList((current) => current.map((item) => ({ ...item, read: true })));
      setNotice(`${data.updated} notification${data.updated === 1 ? "" : "s"} marked read.`);
    } catch { setNotice("Connection failed. Notifications were not updated."); }
    finally { setBusy(""); }
  };

  const notificationHref = (item: any) => {
    if (item.resourceType === "Product" && item.resourceId) return `/product/${item.resourceId}`;
    if (item.resourceType === "Merchant" && item.resourceId) return `/merchant/${item.resourceId}`;
    if (item.resourceType === "ItemRequest" && item.resourceId) return "/requests";
    if (["Reservation", "ServiceBooking"].includes(item.resourceType) && item.resourceId) return "/activity";
    return "/activity";
  };

  const shownNotifications = notificationList.filter((item) => (!unreadOnly || !item.read) && (category === "all" || notificationCategory(item.type) === category));
  const totalActivity = reservationList.length + bookingList.length + requestList.length + notificationList.length;
  const unreadCount = notificationList.filter((item) => !item.read).length;

  const ReservationCards = ({ items }: { items: any[] }) => items.length ? <div className="space-y-3">
    {items.map((r) => <article key={r.id} id={`reservation-${r.id}`} className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex gap-3">
        {r.product.imageUrl ? <img src={r.product.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100" /> : <div aria-hidden="true" className="h-16 w-16 shrink-0 rounded-xl bg-slate-100" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{r.product.name}</div>
          <div className="text-xs text-slate-500 truncate">{r.merchant.businessName} · {r.merchant.area}</div>
          <div className="mt-1 flex items-center gap-2"><span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${statusColor[r.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>{r.status.replaceAll("_", " ")}</span><span className="text-xs text-slate-500">{r.code}</span></div>
        </div>
        <div className="text-right"><div className="font-black">{reservationMoney(r.totalAmount, r.product?.currency)}</div><div className="text-xs text-slate-500">{r.quantity} × {reservationMoney(r.priceSnapshot, r.product?.currency)}</div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "PENDING" && <button disabled={busy === r.id} onClick={() => void actReservation(r.id, "cancel")} className="min-h-10 px-4 rounded-full bg-white border border-slate-200 font-semibold text-sm disabled:opacity-50">Cancel request</button>}
        {r.status === "READY_FOR_PICKUP" && <div className="min-h-10 px-4 grid place-items-center rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-sm">Ready for pickup — show code {r.code}</div>}
        <Link href={`/product/${r.productId}`} className="min-h-10 px-4 grid place-items-center rounded-full bg-slate-900 text-white text-sm font-semibold">View product</Link>
      </div>
      <div className="mt-2 text-xs text-slate-600">Pickup branch: {r.branch ? `${r.branch.name} · ${merchantLocationLabel(r.branch)}` : "Branch location not recorded for this legacy reservation"}</div>
      <div className="mt-1 text-xs text-slate-500">Pickup window: {r.pickupWindow || "not provided by the merchant"} · Expires {new Date(r.expiresAt).toLocaleString()}</div>
    </article>)}
  </div> : <EmptyState title="No reservations recorded." />;

  const BookingCards = ({ items }: { items: any[] }) => items.length ? <div className="space-y-3">
    {items.map((booking) => <article key={booking.id} id={`booking-${booking.id}`} className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div><div className="font-bold">{booking.service.name}</div><div className="text-sm text-slate-600">{booking.merchant.businessName} · {booking.merchant.area}</div><div className="mt-1 text-sm">{new Date(booking.startTime).toLocaleString()} – {new Date(booking.endTime).toLocaleTimeString()}</div><div className="text-xs text-slate-500">{booking.priceSnapshot !== null ? `Price snapshot: ${formatNaira(booking.priceSnapshot)}` : "No price snapshot"} · provider confirmation required</div></div>
        <span className={`w-fit text-[11px] font-bold uppercase px-2.5 py-1 rounded-full border ${statusColor[booking.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>{booking.status.replaceAll("_", " ")}</span>
      </div>
      {(["REQUESTED", "CONFIRMED"].includes(booking.status)) && <button disabled={busy === booking.id} onClick={() => void actBooking(booking.id, "cancel")} className="mt-3 min-h-10 px-4 rounded-full bg-white border border-slate-200 font-semibold text-sm disabled:opacity-50">Cancel appointment</button>}
    </article>)}
  </div> : <EmptyState title="No appointment requests recorded." />;

  const RequestCards = ({ items }: { items: any[] }) => items.length ? <div className="space-y-3">
    {items.map((request) => <article key={request.id} className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold">{request.productName}</div><div className="text-xs text-slate-500">Your item request · {new Date(request.createdAt).toLocaleString()}</div></div><span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full border ${statusColor[request.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>{request.status.replaceAll("_", " ")}</span></div>
      {request.responses?.length ? <div className="mt-3 space-y-2">{request.responses.map((response: any) => <div key={response.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="font-semibold">{response.merchant?.businessName || "Merchant response"} · {response.status}</div><p className="text-slate-600">{response.message}</p><div className="text-xs text-slate-500">{response.price !== null ? `${formatNaira(response.price)} quoted` : "No price quoted"}{response.quantityAvailable !== null ? ` · ${response.quantityAvailable} reported available` : ""}{response.fulfilment ? ` · ${response.fulfilment}` : ""}{response.additionalFees ? ` · fees ${formatNaira(response.additionalFees)}` : ""}</div><div className="mt-1 text-xs text-amber-800">{response.confirmationState === "MERCHANT_REPORTED" ? "Merchant-reported quote; availability is not independently confirmed." : response.confirmationState}</div></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No merchant quotes or responses yet.</p>}
      <Link href="/requests" className="mt-3 inline-block text-sm font-semibold text-emerald-800 underline">Review request and responses</Link>
    </article>)}
  </div> : <EmptyState title="No item requests recorded." />;

  const Notifications = () => <section aria-label="Notifications">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap gap-2">
        <label className="text-xs font-semibold text-slate-600">Category <select value={category} onChange={(event) => setCategory(event.target.value)} className="ml-1 min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">All</option><option value="activity">Activity</option><option value="alerts">Alerts</option><option value="business">Business</option><option value="security">Security</option><option value="updates">Updates</option></select></label>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Unread only</label>
      </div>
      <button disabled={!unreadCount || busy === "all-notifications"} onClick={() => void markAllRead()} className="min-h-10 px-4 rounded-full bg-slate-900 text-white text-sm font-semibold disabled:opacity-40">{busy === "all-notifications" ? "Updating…" : `Mark all read (${unreadCount})`}</button>
    </div>
    {shownNotifications.length ? <div className="mt-4 space-y-2">{shownNotifications.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.read ? "border-slate-200 bg-white" : "border-emerald-200 bg-emerald-50/50"}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.title}</strong><span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{notificationCategory(item.type)}</span>{!item.read && <span className="text-[10px] font-bold uppercase text-emerald-800">Unread</span>}</div><p className="mt-1 text-sm text-slate-600">{item.body}</p><time className="mt-1 block text-xs text-slate-400" dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time></div>
        <div className="flex shrink-0 flex-col gap-2"><Link href={notificationHref(item)} className="text-xs font-semibold text-emerald-800 underline">Open</Link>{item.read ? <button disabled={busy === item.id} onClick={() => void markNotification(item.id, false)} className="text-xs underline disabled:opacity-50">Mark unread</button> : <button disabled={busy === item.id} onClick={() => void markNotification(item.id, true)} className="text-xs underline disabled:opacity-50">Mark read</button>}</div>
      </div>
    </article>)}</div> : <div className="mt-4"><EmptyState title={unreadOnly ? "No unread notifications in this filter." : "No notifications in this filter."} /></div>}
    <p className="mt-3 text-xs text-slate-500">These are in-app records. Email, SMS, WhatsApp, and push delivery are not configured or claimed.</p>
  </section>;

  if (!totalActivity) return <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-10 text-center"><div className="text-3xl">📦</div><div className="font-bold mt-2">No activity yet</div><div className="text-sm text-slate-500">Reservations, service requests, item requests, and in-app notifications will appear here.</div><Link href="/search" className="inline-block mt-4 px-6 py-2 rounded-full bg-live-black text-white text-sm font-semibold">Start searching</Link></div>;

  return <div>
    <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Activity categories">
      {tabs.map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold border ${tab === value ? "bg-live-black text-white border-live-black" : "bg-white border-slate-200"}`}>{value}{value === "Notifications" ? ` (${unreadCount} unread)` : ""}</button>)}
    </div>
    {notice && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">{notice}</div>}
    <div className="mt-5 space-y-6">
      {(tab === "All activity" || tab === "Reservations") && <section aria-labelledby="activity-reservations-title"><div className="mb-3 flex items-center justify-between"><h2 id="activity-reservations-title" className="font-bold">Reservations <span className="text-slate-500">{reservationList.length}</span></h2></div><ReservationCards items={reservationList} /></section>}
      {(tab === "All activity" || tab === "Appointments") && <section aria-labelledby="activity-bookings-title"><div className="mb-3 flex items-center justify-between"><h2 id="activity-bookings-title" className="font-bold">Appointments <span className="text-slate-500">{bookingList.length}</span></h2></div><BookingCards items={bookingList} /></section>}
      {(tab === "All activity" || tab === "Requests & quotes") && <section aria-labelledby="activity-requests-title"><div className="mb-3 flex items-center justify-between"><h2 id="activity-requests-title" className="font-bold">Requests & quotations <span className="text-slate-500">{requestList.length}</span></h2></div><RequestCards items={requestList} /></section>}
      {tab === "Notifications" && <Notifications />}
    </div>
  </div>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">{title}</div>;
}
