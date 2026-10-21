import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import MerchantClient from "./MerchantClient";
import { canManageReservations, merchantRole } from "@/lib/permissions";
import ClientCreate from "./ClientCreate";
import { BottomNav, Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default async function MerchantConsole() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/merchant");

  const memberships = await prisma.merchantMembership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { merchant: true } });
  const owned = await prisma.merchant.findMany({ where: { ownerId: user.id } });
  const allMap = new Map<string, any>();
  memberships.forEach((membership) => allMap.set(membership.merchant.id, membership.merchant));
  owned.forEach((merchant) => allMap.set(merchant.id, merchant));
  const baseMerchants = Array.from(allMap.values());
  if (baseMerchants.length === 0) return <NeedMerchant user={user} />;

  const merchants = await Promise.all(baseMerchants.map(async (merchant) => ({ ...merchant, userRole: await merchantRole(merchant.id, user.id) })));
  const activeId = merchants[0].id;
  const activeRow = await prisma.merchant.findUnique({ where: { id: activeId }, include: { products: { where: { archived: false }, include: { branch: true } }, branches: { include: { state: true, lga: true, cityArea: true }, orderBy: { createdAt: "asc" } }, state: true, lga: true, cityArea: true } });
  if (!activeRow) redirect("/merchant");
  const active = { ...activeRow, userRole: merchants[0].userRole };
  const role = merchants[0].userRole;
  const reservations = canManageReservations(role) ? await prisma.reservation.findMany({
    where: { merchantId: activeId },
    select: {
      id: true, code: true, quantity: true, totalAmount: true, status: true, pickupWindow: true, expiresAt: true,
      product: { select: { id: true, name: true, imageUrl: true, currency: true } },
      branch: { select: { id: true, name: true, area: true, city: true, state: { select: { name: true } }, lga: { select: { name: true } }, cityArea: { select: { name: true } }, locality: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" }, take: 20,
  }) : [];
  const services = await prisma.service.findMany({
    where: { merchantId: activeId },
    select: { id: true, name: true, description: true, price: true, durationMin: true, capacity: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const serviceBookings = canManageReservations(role) ? await prisma.serviceBooking.findMany({
    where: { merchantId: activeId },
    select: { id: true, startTime: true, endTime: true, status: true, priceSnapshot: true, service: { select: { id: true, name: true, durationMin: true } } },
    orderBy: { startTime: "asc" }, take: 50,
  }) : [];
  const lowStock = active.products.filter((product) => !product.archived && (product.availability === "LOW_STOCK" || product.stockQuantity - product.reservedQuantity <= product.lowStockThreshold)).slice(0, 5);

  return <MerchantClient user={user} merchants={merchants} activeMerchant={active} reservations={reservations} serviceBookings={serviceBookings} services={services} lowStock={lowStock} />;
}

function NeedMerchant({ user }: { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> }) {
  return <div className="min-h-screen bg-slate-50">
    <Header user={user} />
    <main className="mx-auto max-w-[820px] px-4 py-8 pb-24">
      <h1 className="font-black text-2xl">Merchant console</h1>
      <p className="mt-2 text-sm text-slate-500">Create a business listing with its state and LGA. New listings start pending review; location selection is not independent verification.</p>
      <ClientCreate />
    </main>
    <BottomNav pathname="/merchant" />
  </div>;
}
