import { prisma } from "@/lib/db";
import { Header, BottomNav } from "@/components/Header";
import { getCurrentUser } from "@/lib/auth";
import { formatNaira } from "@/lib/utils";
import { publicMarketplaceCategoryWhere, publicMarketplaceServiceIds } from "@/lib/marketplace";
import Link from "next/link";
export const dynamic="force-dynamic";
export default async function ServicesPage(){
  const user=await getCurrentUser().catch(()=>null);
  const candidateServices = await prisma.service.findMany({
    where: { merchant: { status: "APPROVED" }, marketplaceListing: { is: { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true, category: { is: publicMarketplaceCategoryWhere() } } } },
    include: { merchant: true }, orderBy: { updatedAt: "desc" }, take: 100,
  });
  const publicServiceIds = await publicMarketplaceServiceIds(candidateServices.map((service) => service.id));
  const services = candidateServices.filter((service) => publicServiceIds.has(service.id)).slice(0, 30);
  return (
    <div className="min-h-screen"><Header user={user}/>
      <div className="mx-auto max-w-[1000px] px-4 py-6 pb-24">
        <h1 className="font-black text-2xl">Book a service</h1>
        <p className="text-sm text-slate-500">Barbers, salons, mechanics, repairs and more. A requested slot only becomes a booking when the provider confirms — Live keeps those states separate.</p>
        <div className="mt-5 grid md:grid-cols-2 gap-4">
          {services.map(s=>(
            <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">{s.merchant.businessName} • {s.merchant.area} • {s.merchant.storeStatus}</div>
              <div className="font-bold text-lg mt-1">{s.name}</div>
              <p className="text-sm text-slate-600">{s.description}</p>
              <div className="text-sm mt-2">{s.price !== null ? <b>{formatNaira(s.price)}</b> : "Price on request"} {s.durationMin?`• ~${s.durationMin} min`:""} • provider-listed capacity {s.capacity}/slot</div>
              <Link href={`/merchant/${s.merchant.id}`} className="mt-4 inline-grid h-10 px-6 place-items-center rounded-full bg-live-black text-white text-sm font-semibold">View provider & request slot</Link>
            </div>
          ))}
        </div>
        {services.length===0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-8 text-center">
            <p className="font-bold">No services published yet</p>
            <p className="text-sm text-slate-500 mt-1">Only approved services that pass Live’s category, review, and marketplace-readiness checks appear here.</p>
          </div>
        )}
      </div>
      <BottomNav pathname="/search"/>
    </div>
  );
}
