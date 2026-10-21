import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/Header";
import MarketplaceReviewClient from "./MarketplaceReviewClient";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminMarketplacePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/admin/marketplace");
  if (!user.isAdmin) notFound();
  const admin = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  if (!admin || !["REVIEWER", "SUPER"].includes(admin.adminRole || "")) notFound();
  return <div className="min-h-screen bg-slate-50"><MarketplaceReviewClient /><BottomNav pathname="/admin/marketplace" /></div>;
}
