import Link from "next/link";
import { formatNaira } from "@/lib/utils";
import { merchantLocationLabel } from "@/lib/location-label";

type Props = {
  productCount: number;
  businesses: any[];
  services: any[];
  activity: any[];
  signedIn: boolean;
};

export default function UnifiedSearchGroups({ productCount, businesses, services, activity, signedIn }: Props) {
  const groups = [
    { id: "unified-products", label: "Products", count: productCount },
    { id: "unified-businesses", label: "Businesses", count: businesses.length },
    { id: "unified-services", label: "Services", count: services.length },
    ...(signedIn ? [{ id: "unified-your-live", label: "Your Live", count: activity.length }] : []),
  ];

  return <>
    <nav aria-label="Search result groups" className="mt-4 flex flex-wrap gap-2">
      {groups.map((group) => <a key={group.id} href={`#${group.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">{group.label} <span className="text-slate-500">{group.count}</span></a>)}
    </nav>

    {businesses.length > 0 && <section id="unified-businesses" aria-labelledby="unified-businesses-title" className="mt-6">
      <div className="live-section-heading"><div><div className="live-eyebrow">Approved public profiles</div><h2 id="unified-businesses-title" className="live-section-title">Businesses</h2></div></div>
      <div className="grid gap-3 md:grid-cols-2">
        {businesses.map((business) => {
          const branch = business.branches?.[0];
          const location = branch ? `${branch.name} · ${merchantLocationLabel(branch)}` : merchantLocationLabel(business);
          const status = branch?.storeStatus || business.storeStatus;
          return <Link key={business.id} href={`/merchant/${business.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
            <div className="font-bold">{business.businessName}</div>
            <div className="mt-1 text-sm text-slate-600">{business.category} · {location}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-slate-200 px-2 py-1">Merchant marked {status === "OPEN" ? "open" : "closed"}</span>
              {business.verificationStatus === "VERIFIED" && <span className="rounded-full bg-slate-900 px-2 py-1 text-white">Verified merchant</span>}
            </div>
          </Link>;
        })}
      </div>
    </section>}

    {services.length > 0 && <section id="unified-services" aria-labelledby="unified-services-title" className="mt-6">
      <div className="live-section-heading"><div><div className="live-eyebrow">Merchant-published services</div><h2 id="unified-services-title" className="live-section-title">Services</h2></div></div>
      <div className="grid gap-3 md:grid-cols-2">
        {services.map((service) => <Link key={service.id} href={`/merchant/${service.merchant.id}#merchant-services`} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <div className="font-bold">{service.name}</div>
          <div className="mt-1 text-sm text-slate-600">{service.merchant.businessName} · {merchantLocationLabel(service.merchant)}</div>
          {service.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{service.description}</p>}
          <div className="mt-2 text-xs text-slate-600">{service.price !== null ? `${formatNaira(service.price)} listed` : "Price on request"}{service.durationMin ? ` · ${service.durationMin} min` : ""} · Request a slot; provider confirmation is required.</div>
        </Link>)}
      </div>
    </section>}

    {signedIn && <section id="unified-your-live" aria-labelledby="unified-your-live-title" className="mt-6">
      <div className="live-section-heading"><div><div className="live-eyebrow">Private to your signed-in account</div><h2 id="unified-your-live-title" className="live-section-title">Your Live</h2></div></div>
      {activity.length ? <div className="grid gap-2 md:grid-cols-2">
        {activity.map((item) => <Link key={`${item.type}:${item.id}`} href={item.href} className="rounded-xl border border-slate-200 bg-white p-3 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <div className="flex items-start justify-between gap-3"><strong className="text-sm">{item.title}</strong><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold">{item.status.replaceAll("_", " ")}</span></div>
          <div className="mt-1 text-xs text-slate-500">{item.type.replaceAll("_", " ")} · {item.subtitle}</div>
        </Link>)}
      </div> : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No matching saved items, searches, lists, requests, reservations, or appointments were found in your account.</p>}
    </section>}
  </>;
}
