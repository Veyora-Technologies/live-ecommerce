import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import BulkClient from "./BulkClient";
import { canEditInventory, merchantRole } from "@/lib/permissions";
export const dynamic="force-dynamic";
export default async function BulkPage({ searchParams }: { searchParams: Promise<any> }){
  const user=await getCurrentUser();
  if(!user) redirect("/auth/login?next=/merchant/bulk");
  const sp=await searchParams;
  const merchants=await prisma.merchant.findMany({ where:{ OR:[{ownerId:user.id},{ memberships:{ some:{ userId:user.id, status:"ACTIVE" }}}]}});
  if(!merchants.length) redirect("/merchant");
  const activeId=sp.merchantId && merchants.some(m=>m.id===sp.merchantId)? sp.merchantId : merchants[0].id;
  const canEdit=canEditInventory(await merchantRole(activeId,user.id));
  return (
    <div className="min-h-screen bg-slate-50"><div className="mx-auto max-w-[1000px] px-4 py-6">
      <Link href="/merchant" className="text-sm text-slate-600">← Furnivo Business</Link>
      <h1 className="mt-2 font-black text-2xl">Bulk stock & prices</h1>
      <p className="text-sm text-slate-500">CSV import with preview, validation and per-row results. Prices are NGN major units and every row must explicitly state <b>currency=NGN</b>; currencyless or non-NGN rows fail without conversion. Nothing is silently half-applied — you see every success and failure.</p>
      <div className="mt-3 flex flex-wrap gap-2">{merchants.map(m=>(<Link key={m.id} href={`/merchant/bulk?merchantId=${m.id}`} className={`px-4 py-2 rounded-full text-sm font-semibold ${m.id===activeId?"bg-live-black text-white":"bg-white border border-slate-200"}`}>{m.businessName}</Link>))}</div>
      <BulkClient merchantId={activeId} canEdit={canEdit}/>
    </div></div>
  );
}
