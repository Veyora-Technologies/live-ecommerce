import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import ConnectClient from "./ConnectClient";
export const dynamic="force-dynamic";
export default async function ConnectPage({ searchParams }: { searchParams: Promise<any> }){
  const user=await getCurrentUser();
  if(!user) redirect("/auth/login?next=/merchant/connect");
  const sp=await searchParams;
  const merchants=await prisma.merchant.findMany({ where:{ OR:[{ownerId:user.id},{ memberships:{ some:{ userId:user.id, status:"ACTIVE" }}}]}});
  if(!merchants.length) redirect("/merchant");
  const activeId=sp.merchantId && merchants.some(m=>m.id===sp.merchantId)? sp.merchantId : merchants[0].id;
  const active=merchants.find(m=>m.id===activeId)!;
  return (
    <div className="min-h-screen bg-slate-50"><div className="mx-auto max-w-[1100px] px-4 py-6">
      <Link href="/merchant" className="text-sm text-slate-600">← Live Business</Link>
      <h1 className="mt-2 font-black text-2xl">Live Connect — branches, team, services & integrations</h1>
      <p className="text-sm text-slate-500">One workspace for {active.businessName}. Integrations only sync after real credentials are configured and tested — nothing is faked as “connected”.</p>
      <div className="mt-3 flex flex-wrap gap-2">{merchants.map(m=>(<Link key={m.id} href={`/merchant/connect?merchantId=${m.id}`} className={`px-4 py-2 rounded-full text-sm font-semibold ${m.id===activeId?"bg-live-black text-white":"bg-white border border-slate-200"}`}>{m.businessName}</Link>))}</div>
      <ConnectClient merchant={JSON.parse(JSON.stringify(active))}/>
    </div></div>
  );
}
