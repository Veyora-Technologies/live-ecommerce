import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Header } from "@/components/Header";
import { redirect } from "next/navigation";
import RequestsClient from "./RequestsClient";
export const dynamic="force-dynamic";
export default async function RequestsPage(){
  const user=await getCurrentUser();
  if(!user) redirect("/auth/login?next=/requests");
  const myRequests=await prisma.itemRequest.findMany({ where:{ requesterId:user.id }, orderBy:{ createdAt:"desc"}, include:{ responses:true }});
  const openDemand=await prisma.itemRequest.findMany({ where:{ status:"OPEN"}, take:10 });
  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="mx-auto max-w-[900px] px-4 py-6">
        <h1 className="font-black text-2xl">Request an Item</h1>
        <p className="text-sm text-slate-500">Can’t find it? Submit a request. Merchants in your area will be notified. Your phone is never shared without consent.</p>
        <RequestsClient myRequests={myRequests} openDemand={openDemand} />
      </div>
    </div>
  );
}
