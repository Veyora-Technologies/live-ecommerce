import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import AdminClient from "./AdminClient";
import { normalizeAdminRole } from "@/lib/admin-roles";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (!user.isAdmin) notFound();

  const adminProfile = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  const adminRole = normalizeAdminRole(adminProfile?.adminRole);
  // `isAdmin` alone is not an operational role. An account with adminRole NONE
  // must not receive cross-tenant data (user emails/phones, merchant list) that
  // it cannot act on; the API routes enforce the same rule.
  if (adminRole === "NONE") notFound();
  const [merchants, reservations, reports, users, audit] = await Promise.all([
    prisma.merchant.findMany({
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, name: true } }, products: { select: { id: true } } },
    }),
    prisma.reservation.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        product: { select: { id: true, name: true } },
        merchant: { select: { id: true, businessName: true } },
        consumer: { select: { id: true, name: true } },
      },
    }),
    prisma.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        reporter: { select: { id: true, name: true } },
        merchant: { select: { id: true, businessName: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, email: true, phone: true, role: true, isAdmin: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true },
    }),
  ]);

  return <AdminClient user={{ ...user, adminRole }} merchants={merchants} reservations={reservations} reports={reports} users={users} audit={audit} />;
}
