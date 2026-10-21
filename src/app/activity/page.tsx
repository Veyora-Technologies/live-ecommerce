import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Header, BottomNav } from "@/components/Header";
import { redirect } from "next/navigation";
import ActivityClient from "./ActivityClient";
import { reservationViewSelect } from "@/lib/reservation-view";

export const dynamic="force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }){
  const { tab } = await searchParams;
  const initialTab = tab === "notifications" ? "Notifications" : tab === "appointments" ? "Appointments" : "All activity";
  const user = await getCurrentUser();
  if(!user) redirect("/auth/login?next=/activity");
  const [reservations, bookings, requests, notifications] = await Promise.all([
    prisma.reservation.findMany({ where: { consumerId: user.id }, select: reservationViewSelect, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.serviceBooking.findMany({ where: { consumerId: user.id }, include: { service: { select: { id: true, name: true, durationMin: true } }, merchant: { select: { id: true, businessName: true, area: true } } }, orderBy: { startTime: "desc" }, take: 50 }),
    prisma.itemRequest.findMany({ where: { requesterId: user.id }, include: { responses: { select: { id: true, message: true, price: true, quantityAvailable: true, validUntil: true, fulfilment: true, additionalFees: true, confirmationState: true, status: true, createdAt: true, merchant: { select: { id: true, businessName: true, area: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.findMany({ where: { recipientId: user.id }, select: { id: true, type: true, title: true, body: true, resourceType: true, resourceId: true, read: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="mx-auto max-w-[800px] px-4 py-6 pb-24">
        <h1 className="font-black text-2xl">Your activity</h1>
        <p className="text-sm text-slate-500">Reservations, bookings, and notifications — all in one place.</p>
        <ActivityClient reservations={reservations} bookings={bookings} requests={requests} notifications={notifications} initialTab={initialTab} />
      </div>
      <BottomNav pathname="/activity" />
    </div>
  );
}
