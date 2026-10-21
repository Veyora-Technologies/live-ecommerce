import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import InsightsClient from "./InsightsClient";
export const dynamic="force-dynamic";
export default async function InsightsPage({ searchParams }: { searchParams: Promise<any> }){
  const user=await getCurrentUser();
  if(!user) redirect("/auth/login?next=/merchant/insights");
  const sp=await searchParams;
  const merchants=await prisma.merchant.findMany({ where:{ OR:[{ownerId:user.id},{ memberships:{ some:{ userId:user.id }}}]}});
  if(!merchants.length) redirect("/merchant");
  const activeId = sp.merchantId && merchants.some(m=>m.id===sp.merchantId) ? sp.merchantId : merchants[0].id;
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <Link href="/merchant" className="text-sm text-slate-600">← Live Business</Link>
        <h1 className="mt-2 font-black text-2xl">Live Insights</h1>
        <p className="text-sm text-slate-500">Real demand, stock and fulfilment signals from your stored records. Estimates are labelled; nothing is invented.</p>
        <div className="mt-3 flex flex-wrap gap-2">{merchants.map(m=>(<Link key={m.id} href={`/merchant/insights?merchantId=${m.id}`} className={`px-4 py-2 rounded-full text-sm font-semibold ${m.id===activeId?"bg-live-black text-white":"bg-white border border-slate-200"}`}>{m.businessName}</Link>))}</div>
        <InsightsClient merchantId={activeId} />
      </div>
    </div>
  );
}
