import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ComplianceClient from "./ComplianceClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance casework · Live operations" };
const allowedRoles = ["SUPER", "SECURITY", "REVIEWER", "SUPPORT"] as const;

export default async function CompliancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=%2Fadmin%2Fcompliance");
  const admin = await prisma.user.findUnique({ where: { id: user.id }, select: { isAdmin: true, adminRole: true } });
  if (!admin?.isAdmin || !allowedRoles.includes(admin.adminRole as (typeof allowedRoles)[number])) notFound();
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-7xl"><ComplianceClient role={admin.adminRole as (typeof allowedRoles)[number]} /></div></main>;
}
