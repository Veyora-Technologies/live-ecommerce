import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, BottomNav } from "@/components/Header";
import { ProductCard, MerchantCard } from "@/components/ProductCard";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findGeographicArea, geographicPath, getGeographicProductWhere, getGeographicScopeFilter } from "@/lib/geography";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { publicMarketplaceProductIds } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ code: string }> };

async function getLocation(code: string) {
  if (!/^[A-Za-z0-9-]{2,64}$/.test(code)) return null;
  return findGeographicArea(code);
}

async function getCounts(code: string) {
  try {
    const filter = await getGeographicScopeFilter([code], "admin");
    const where = { status: "APPROVED", OR: [filter.where, { branches: { some: filter.where } }] };
    const [merchantCount, candidates] = await Promise.all([
      prisma.merchant.count({ where }),
      prisma.product.findMany({
        where: { archived: false, merchant: { status: "APPROVED" }, ...getGeographicProductWhere(filter) },
        select: { id: true, stockQuantity: true, reservedQuantity: true, lowStockThreshold: true, availability: true },
      }),
    ]);
    const eligibleIds = await publicMarketplaceProductIds(candidates.map((product) => product.id));
    const reservable = await withReservableAvailability(candidates.filter((product) => eligibleIds.has(product.id)));
    return { merchantCount, productCount: reservable.filter((product) => product.reservableQuantity > 0).length };
  } catch { return { merchantCount: 0, productCount: 0 }; }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const area = await getLocation(code);
  if (!area) return { title: "Location not found · Furnivo", robots: { index: false, follow: true } };
  const counts = await getCounts(area.code);
  const title = `${area.name} on Furnivo · Merchant listings`;
  const description = counts.productCount
    ? `Explore ${counts.productCount} currently listed product${counts.productCount === 1 ? "" : "s"} and approved merchants recorded for ${geographicPath(area)} on Furnivo.`
    : `See whether real merchant listings are currently recorded for ${geographicPath(area)} on Furnivo.`;
  return { title, description, robots: { index: counts.merchantCount > 0 || counts.productCount > 0, follow: true } };
}

export default async function LocationPage({ params }: PageProps) {
  const { code } = await params;
  const area = await getLocation(code);
  if (!area) notFound();
  const user = await getCurrentUser().catch(() => null);
  const filter = await getGeographicScopeFilter([area.code], "admin");
  const merchantWhere = { status: "APPROVED", OR: [filter.where, { branches: { some: filter.where } }] };
  const [rawProducts, merchants, counts] = await Promise.all([
    prisma.product.findMany({
      where: { archived: false, availability: { in: ["IN_STOCK", "LOW_STOCK"] }, merchant: { status: "APPROVED" }, ...getGeographicProductWhere(filter) },
      include: { merchant: { include: { state: true, lga: true, cityArea: true } }, branch: { include: { state: true, lga: true, cityArea: true } } }, orderBy: { lastConfirmedAt: "desc" }, take: 24,
    }),
    prisma.merchant.findMany({ where: merchantWhere, include: { state: true, lga: true, cityArea: true }, orderBy: { updatedAt: "desc" }, take: 12 }),
    getCounts(area.code),
  ]);
  const publicProductIds = await publicMarketplaceProductIds(rawProducts.map((product) => product.id));
  const products = (await withReservableAvailability(rawProducts.filter((product) => publicProductIds.has(product.id)))).filter((product) => product.reservableQuantity > 0);
  const locationLabel = geographicPath(area);
  const searchHref = `/search?scope=admin&locationCode=${encodeURIComponent(area.code)}`;

  return <div className="min-h-screen">
    <Header user={user} />
    <main className="live-wrap live-main">
      <nav aria-label="Breadcrumb" className="live-location-breadcrumb"><Link href="/">Furnivo home</Link><span aria-hidden="true">/</span><span>{locationLabel}</span></nav>
      <section className="live-location-hero">
        <p className="live-eyebrow">Nigeria geography · {area.type.replaceAll("_", " ").toLowerCase()}</p>
        <h1>{area.name}</h1>
        <p>Coverage and listings are based only on records currently in Furnivo. A selectable location is not evidence that a merchant, item, stock or delivery service is available there.</p>
        <div className="live-location-actions"><Link className="live-button live-button-primary" href={searchHref}>Search this area</Link><Link className="live-button" href="/search?scope=nationwide">Search all Nigeria</Link></div>
      </section>

      <section className="live-location-section" aria-labelledby="location-products-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Merchant-reported listings</div><h2 id="location-products-title" className="live-section-title">Products recorded for {area.name}</h2></div><span className="live-location-count">{counts.productCount} recorded</span></div>
        {products.length ? <div className="live-product-grid">{products.map((product) => <ProductCard key={product.id} p={product} />)}</div> : <div className="live-empty-card"><strong>No currently reservable product listings recorded for {area.name}.</strong><p>This page stays available for browsing, but it is not claiming local stock or merchant coverage. Widen the scope or try another location.</p><Link className="live-button" href="/search?scope=nationwide">Browse all Nigeria</Link></div>}
      </section>

      <section className="live-location-section" aria-labelledby="location-merchants-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Approved business profiles</div><h2 id="location-merchants-title" className="live-section-title">Merchants recorded for {area.name}</h2></div><span className="live-location-count">{counts.merchantCount} recorded</span></div>
        {merchants.length ? <div className="live-merchant-grid">{merchants.map((merchant) => <MerchantCard key={merchant.id} m={merchant} />)}</div> : <div className="live-empty-card"><strong>No approved merchant profiles are currently recorded for this location.</strong><p>Furnivo supports searching this geography, but commercial coverage is not yet confirmed in the app.</p><Link className="live-button" href="/merchant">Add a merchant profile</Link></div>}
      </section>
    </main>
    <BottomNav pathname="/location" />
  </div>;
}
