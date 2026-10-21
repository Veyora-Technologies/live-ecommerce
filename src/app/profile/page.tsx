import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Header, BottomNav } from "@/components/Header";
import { redirect } from "next/navigation";
import ProfileSettings from "./ProfileSettings";
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const [contact, merchantAccess, unreadNotificationCount, collected] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { email: true, phone: true } }),
    prisma.merchant.findFirst({
      where: { OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, status: "ACTIVE" } } }] },
      select: { id: true },
    }),
    prisma.notification.count({ where: { recipientId: user.id, read: false } }),
    prisma.reservation.findMany({
      where: { consumerId: user.id, status: "COLLECTED" },
      include: { product: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);
  const recentProducts = [...new Map(collected.map((reservation) => [reservation.product.id, reservation.product])).values()].slice(0, 5);

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <main className="mx-auto max-w-[800px] px-4 py-6 pb-24">
        <section className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-live-black text-xl font-black text-white">{user.name.charAt(0)}</div>
          <div className="min-w-0">
            <div className="font-black text-lg">{user.name}</div>
            <div className="break-words text-sm text-slate-500">{contact?.email || "No email on file"}{contact?.phone ? ` • ${contact.phone}` : ""}</div>
            <div className="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">{user.role}{user.isAdmin ? " • Admin" : ""}</div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Account destinations">
          <a href="/activity" className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <div className="font-bold">Activity</div>
            <div className="text-sm text-slate-500">View your reservations and notifications</div>
          </a>
          <a href="/merchant" className="rounded-2xl bg-live-green-ink p-5 text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
            <div className="font-bold">{merchantAccess ? "Business workspace →" : "Set up a business listing →"}</div>
            <div className="text-sm text-white/85">{merchantAccess ? "Open a workspace you are authorized to manage" : "Submit a business listing for review; location does not imply verification"}</div>
          </a>
          {user.isAdmin && <a href="/admin" className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <div className="font-bold">Admin dashboard</div>
            <div className="text-sm text-slate-500">Platform administration</div>
          </a>}
          <a href="/profile/security" className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <div className="font-bold">Account security</div>
            <div className="text-sm text-slate-500">Password, two-factor authentication, sessions, and data</div>
          </a>
          <a href="/cart" className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <div className="font-bold">My plan</div>
            <div className="text-sm text-slate-500">Review your multi-merchant plan</div>
          </a>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <div className="font-bold text-red-600">Sign out</div>
              <div className="text-sm text-slate-500">Revoke this session and return to Live</div>
            </button>
          </form>
        </section>

        <ProfileSettings recentProducts={JSON.parse(JSON.stringify(recentProducts))} />

        <a href="/activity?tab=notifications" className="mt-6 block rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          <div className="font-bold">Notifications · {unreadNotificationCount} unread</div>
          <div className="text-sm text-slate-500">Open your Activity centre to filter, search, and update in-app notifications.</div>
        </a>
      </main>
      <BottomNav pathname="/profile" />
    </div>
  );
}
