import { redirect } from "next/navigation";
import { BottomNav, Header } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import EnquiriesClient from "./EnquiriesClient";

export const dynamic = "force-dynamic";

export default async function EnquiriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/enquiries");
  return <div className="min-h-screen bg-slate-50"><Header user={user} /><EnquiriesClient /><BottomNav pathname="/enquiries" /></div>;
}
