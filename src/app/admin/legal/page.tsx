import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LegalAdminClient from "./LegalAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Legal and trust controls · Live operations" };

export default async function LegalAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=%2Fadmin%2Flegal");
  const operator = await prisma.user.findUnique({ where: { id: user.id }, select: { isAdmin: true, adminRole: true } });
  if (!operator?.isAdmin || operator.adminRole !== "SUPER") notFound();
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-6xl"><LegalAdminClient /></div></main>;
}
