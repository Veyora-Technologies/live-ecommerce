import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PrivacyAdminClient from "./PrivacyAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy request queue · Live operations" };

export default async function AdminPrivacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=%2Fadmin%2Fprivacy");
  const operator = await prisma.user.findUnique({ where: { id: user.id }, select: { isAdmin: true, adminRole: true } });
  if (!operator?.isAdmin || !["SUPER", "SECURITY"].includes(operator.adminRole || "")) notFound();
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-6xl"><PrivacyAdminClient /></div></main>;
}
