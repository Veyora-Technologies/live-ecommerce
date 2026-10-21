import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { withReservableAvailability } from "@/lib/inventory-availability";
import { getLivePulseUpdates } from "@/lib/pulse";
import { GeographyRequestError, findGeographicArea, getGeographicProductWhere, getGeographicScopeFilter } from "@/lib/geography";
import { Header, BottomNav } from "@/components/Header";
import BrandFooter from "@/components/BrandFooter";
import { ProductCard, MerchantCard } from "@/components/ProductCard";
import SearchHero from "@/components/SearchHero";
import LivePulse from "@/components/LivePulse";
import HomeSections from "@/components/HomeSections";
import HomeProductGrid from "@/components/HomeProductGrid";
import AssistWidget from "@/components/AssistWidget";
import { Activity, ArrowRight, ClipboardList, ListChecks, MapPin, PackageSearch, Store } from "lucide-react";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getMarketBranchWhere, getMarketMerchantWhere, getMarketProductWhere } from "@/lib/market-config";
import { formatNaira } from "@/lib/utils";

export const dynamic = "force-dynamic";

function searchHref(search: { query: string; filters: string | null }) {
  const params = new URLSearchParams({ q: search.query });
  try {
    const filters = JSON.parse(search.filters || "{}");
    for (const key of ["countryCode", "area", "locationCode", "scope", "category", "minPrice", "maxPrice", "sort", "inStock", "openNow", "pickup", "delivery", "verified"]) {
      const value = filters?.[key];
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    if (Array.isArray(filters?.locationCodes)) for (const code of filters.locationCodes) if (typeof code === "string" && code) params.append("locationCode", code);
  } catch { /* older saved searches may have invalid filters; keep the query */ }
  return `/search?${params.toString()}`;
}

function dateLabel(date: Date, locale = "en-NG", timeZone = "Africa/Lagos") {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date) + ` (${timeZone})`;
}

export default async function HomePage() {
  const countryCode = DEFAULT_MARKET_CODE;
  const user = await getCurrentUser().catch(() => null);
  const cookieStore = await cookies();
  const locationCode = user?.preferredLocationCode || cookieStore.get("live_location_code")?.value || "";
  let locationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>> = { where: {}, areas: [], codes: [], countryCode };
  let locationError = "";
  if (locationCode) {
    try { locationFilter = await getGeographicScopeFilter([locationCode], "admin", countryCode); }
    catch (cause) { locationError = cause instanceof GeographyRequestError ? cause.message : "Saved location is unavailable."; }
  }
  const locationName = locationFilter.areas[0]?.name || "";
  const initialLocation = locationCode ? await findGeographicArea(locationCode, countryCode).catch(() => null) : null;
  const safeLocationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>> = locationError ? { where: { id: "__unavailable_location__" }, areas: [], codes: ["__unavailable_location__"], countryCode } : locationFilter;
  const locationProductWhere = getGeographicProductWhere(safeLocationFilter);
  const marketMerchantWhere = getMarketMerchantWhere(countryCode);
  const marketProductWhere = getMarketProductWhere(countryCode);
  const marketBranchWhere = getMarketBranchWhere(countryCode);
  const merchantLocationFilter: Prisma.MerchantWhereInput = locationError
    ? { id: "__unavailable_location__" }
    : locationCode ? { OR: [locationFilter.where, { branches: { some: locationFilter.where } }] } : {};
  const merchantLocationWhere: Prisma.MerchantWhereInput = { AND: [marketMerchantWhere, merchantLocationFilter] };
  const branchWhere: Prisma.BranchWhereInput = locationCode && !locationError ? { AND: [marketBranchWhere, locationFilter.where] } : marketBranchWhere;
  const browseHref = locationCode ? `/search?countryCode=${countryCode}&scope=admin&locationCode=${encodeURIComponent(locationCode)}` : `/search?countryCode=${countryCode}&scope=nationwide`;
  const productWhere: Prisma.ProductWhereInput = { archived: false, availability: { in: ["IN_STOCK", "LOW_STOCK"] }, AND: [locationProductWhere, marketProductWhere] };
  const [rawProducts, merchants, pulseUpdates, savedSearches, savedItems, reservations, recentViews, activeAlerts, lists] = await Promise.all([
    prisma.product.findMany({ where: productWhere, include: { merchant: true, branch: { include: { state: true, lga: true, cityArea: true } } }, take: 24, orderBy: { lastConfirmedAt: "desc" } }),
    prisma.merchant.findMany({ where: { status: "APPROVED", ...merchantLocationWhere }, include: { branches: { where: branchWhere, include: { state: true, lga: true, cityArea: true }, take: 1 } }, take: 4, orderBy: { updatedAt: "desc" } }),
    locationError ? Promise.resolve([]) : getLivePulseUpdates(locationCode ? [locationCode] : [], locationCode ? "admin" : "nationwide", undefined, countryCode).catch(() => []),
    user ? prisma.savedSearch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }) : Promise.resolve([]),
    user ? prisma.savedItem.findMany({ where: { userId: user.id, productId: { not: null }, product: { archived: false, merchant: { status: "APPROVED" }, AND: [marketProductWhere] } }, include: { product: { include: { merchant: true, branch: { include: { state: true, lga: true, cityArea: true } } } } }, orderBy: { createdAt: "desc" }, take: 4 }) : Promise.resolve([]),
    user ? prisma.reservation.findMany({ where: { consumerId: user.id, status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } }, include: { product: true, merchant: true, branch: { include: { state: true, lga: true, cityArea: true } } }, orderBy: { updatedAt: "desc" }, take: 3 }) : Promise.resolve([]),
    user ? prisma.recentView.findMany({ where: { userId: user.id, product: { archived: false, merchant: { status: "APPROVED" }, AND: [marketProductWhere] } }, include: { product: { include: { merchant: true, branch: { include: { state: true, lga: true, cityArea: true } } } } }, orderBy: { viewedAt: "desc" }, take: 4 }) : Promise.resolve([]),
    user ? prisma.priceAlert.findMany({ where: { userId: user.id, active: true, productId: { not: null }, product: { archived: false, merchant: { status: "APPROVED" } } }, include: { product: { select: { id: true, name: true, price: true } } }, orderBy: { lastTriggeredAt: "desc" }, take: 4 }) : Promise.resolve([]),
    user ? prisma.shoppingList.findMany({ where: { ownerId: user.id }, include: { _count: { select: { items: true } } }, orderBy: { updatedAt: "desc" }, take: 3 }) : Promise.resolve([]),
  ]);
  const publicProductIds = await publicMarketplaceProductIds(rawProducts.map((product) => product.id), countryCode);
  const eligibleProducts = rawProducts.filter((product) => publicProductIds.has(product.id));
  const products = (await withReservableAvailability(eligibleProducts)).filter((product) => product.reservableQuantity > 0).slice(0, 8);
  const categoryRows = publicProductIds.size ? await prisma.product.findMany({ where: { id: { in: [...publicProductIds] } }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" }, take: 8 }) : [];
  const categories = categoryRows.map((row) => row.category).filter(Boolean);

  const sections = [
    {
      id: "shortcuts", label: "Quick actions", node: <section aria-labelledby="quick-actions-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Useful next steps</div><h2 id="quick-actions-title" className="live-section-title">Go straight to what you need</h2></div></div>
        <div className="live-shortcut-grid">
          <Link href="/compare?productName=Paracetamol" className="live-shortcut-card"><span className="live-shortcut-icon"><Activity size={20} /></span><span><strong>Compare listings</strong><small>See merchant-listed options side by side</small></span><ArrowRight size={17} /></Link>
          <Link href="/requests" className="live-shortcut-card"><span className="live-shortcut-icon"><ClipboardList size={20} /></span><span><strong>Request an item</strong><small>Ask participating merchants to respond</small></span><ArrowRight size={17} /></Link>
          <Link href="/lists" className="live-shortcut-card"><span className="live-shortcut-icon"><ListChecks size={20} /></span><span><strong>Shopping lists</strong><small>Plan items; each merchant stays separate</small></span><ArrowRight size={17} /></Link>
          <Link href="/merchant" className="live-shortcut-card"><span className="live-shortcut-icon"><Store size={20} /></span><span><strong>For merchants</strong><small>Manage an approved business listing</small></span><ArrowRight size={17} /></Link>
        </div>
      </section>,
    },
    {
      id: "pulse", label: "Live Pulse", node: <LivePulse initialUpdates={pulseUpdates} initialLocationCode={locationCode} initialLocationName={initialLocation?.name || (locationError ? "Saved location unavailable" : "")} userId={user?.id} />,
    },
    {
      id: "available", label: "Available listings", node: <section aria-labelledby="available-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Merchant-reported availability</div><h2 id="available-title" className="live-section-title">{locationName ? `Listings in ${locationName}` : "Recently updated listings across Nigeria"}</h2></div><Link className="live-button" href={`${browseHref}&inStock=true`}>Browse this scope <ArrowRight size={15} /></Link></div>
        <HomeProductGrid initialProducts={products} initialLocationCode={locationCode} initialLocationName={initialLocation?.name || (locationError ? "Saved location unavailable" : "")} userId={user?.id} />
      </section>,
    },
    {
      id: "categories", label: "Categories", node: <section aria-labelledby="categories-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Start broad, refine quickly</div><h2 id="categories-title" className="live-section-title">Explore categories</h2></div><Link className="live-text-link" href="/search">All search results <ArrowRight size={15} /></Link></div>
        {categories.length ? <div className="live-category-grid">{categories.map((category, index) => {
          const icons = [PackageSearch, Store, Activity, ListChecks];
          const Icon = icons[index % icons.length];
          return <Link href={`/search?category=${encodeURIComponent(category)}`} className="live-category-card" key={category}><span><Icon size={20} /></span><strong>{category}</strong><small>Browse listings <ArrowRight size={12} /></small></Link>;
        })}</div> : <div className="live-empty-card"><strong>Categories will appear as merchants publish listings.</strong><p>Try a text search to explore what is currently recorded.</p><Link className="live-button" href="/search">Search Live</Link></div>}
      </section>,
    },
    {
      id: "merchants", label: "Merchant profiles", node: <section aria-labelledby="merchant-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Local business profiles</div><h2 id="merchant-title" className="live-section-title">{locationName ? `Merchants in ${locationName}` : "Approved merchants across Nigeria"}</h2></div><Link className="live-text-link" href={browseHref}>Explore merchant listings <ArrowRight size={15} /></Link></div>
        {merchants.length ? <div className="live-merchant-grid">{merchants.map((merchant) => <MerchantCard key={merchant.id} m={merchant} />)}</div> : <div className="live-empty-card"><strong>{locationName ? `No approved merchant profiles recorded for ${locationName} yet.` : "No approved merchant profiles are recorded nationwide yet."}</strong><p>Choose another scope or clear the location selection. Geography support is not proof of commercial coverage.</p><Link className="live-button" href="/search?scope=nationwide">Browse all Nigeria</Link></div>}
      </section>,
    },
  ];

  if (user) {
    sections.push(
      { id: "saved-searches", label: "Saved searches", node: <section aria-labelledby="saved-search-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Your saved discovery</div><h2 id="saved-search-title" className="live-section-title">Saved searches</h2></div><Link className="live-text-link" href="/my-live">Manage in My Live <ArrowRight size={15} /></Link></div>
        {savedSearches.length ? <div className="live-personal-row">{savedSearches.map((search) => <Link key={search.id} href={searchHref(search)} className="live-personal-card"><span className="live-personal-icon"><PackageSearch size={18} /></span><span><strong>{search.label || search.query}</strong><small>{search.alertEnabled ? `${search.alertFrequency.toLowerCase()} in-app matching alerts` : "Alerts paused"}</small></span><ArrowRight size={16} /></Link>)}</div> : <div className="live-empty-card"><strong>No saved searches yet.</strong><p>Search for something useful and save it to pick up later on any signed-in device.</p><Link href="/search" className="live-button">Start a search</Link></div>}
      </section> },
      { id: "reservations", label: "Upcoming reservations", node: <section aria-labelledby="upcoming-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Your activity</div><h2 id="upcoming-title" className="live-section-title">Reservations to follow</h2></div><Link className="live-text-link" href="/activity">All activity <ArrowRight size={15} /></Link></div>
        {reservations.length ? <div className="live-personal-row">{reservations.map((reservation) => <Link href="/activity" key={reservation.id} className="live-reservation-preview"><span className={`live-status-pill ${reservation.status === "READY_FOR_PICKUP" ? "is-open" : "is-pending"}`}>{reservation.status.replaceAll("_", " ")}</span><strong>{reservation.product.name}</strong><small>{reservation.merchant.businessName} · {reservation.code} · Updated {dateLabel(reservation.updatedAt)}</small></Link>)}</div> : <div className="live-empty-card"><strong>No active reservations.</strong><p>When a reservation is created, its server-confirmed status appears here. A planning cart is not an order.</p><Link href="/search" className="live-button">Find an item</Link></div>}
      </section> },
      { id: "recent", label: "Recently viewed", node: <section aria-labelledby="recent-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Continue from another device</div><h2 id="recent-title" className="live-section-title">Recently viewed</h2></div><Link className="live-text-link" href="/my-live">Open My Live <ArrowRight size={15} /></Link></div>
        {recentViews.length ? <div className="live-recent-grid">{recentViews.map((view) => <Link key={view.id} href={`/product/${view.product.id}`} className="live-recent-card"><strong>{view.product.name}</strong><small>{view.product.merchant.businessName} · {view.product.merchant.area}</small><small>Viewed {dateLabel(view.viewedAt)}</small></Link>)}</div> : <div className="live-empty-card"><strong>Your recent product views will show up here.</strong><p>Product pages you open while signed in are stored to your account so you can continue on another device. You can clear this history in My Live.</p><Link href="/search" className="live-button">Search listings</Link></div>}
      </section> },
      { id: "saved-items", label: "Saved products", node: <section aria-labelledby="saved-items-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Keep useful listings close</div><h2 id="saved-items-title" className="live-section-title">Saved products</h2></div><Link className="live-text-link" href="/my-live">Manage saved items <ArrowRight size={15} /></Link></div>
        {savedItems.filter((item) => item.product).length ? <div className="live-product-grid">{savedItems.filter((item) => item.product).map((item) => <ProductCard key={item.id} p={item.product} />)}</div> : <div className="live-empty-card"><strong>Nothing saved yet.</strong><p>Save a product from its page to compare it later. A saved listing is not a stock confirmation.</p><Link href="/search" className="live-button">Browse listings</Link></div>}
      </section> },
      { id: "lists", label: "Shopping lists", node: <section aria-labelledby="lists-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Planning, not checkout</div><h2 id="lists-title" className="live-section-title">Your shopping lists</h2></div><Link className="live-text-link" href="/lists">Manage lists <ArrowRight size={15} /></Link></div>
        {lists.length ? <div className="live-personal-row">{lists.map((list) => <Link key={list.id} href={`/lists/${list.id}`} className="live-personal-card"><span className="live-personal-icon"><ListChecks size={18} /></span><span><strong>{list.name}</strong><small>{list._count.items} {list._count.items === 1 ? "item" : "items"} · updated {dateLabel(list.updatedAt)}</small></span><ArrowRight size={16} /></Link>)}</div> : <div className="live-empty-card"><strong>No shopping lists yet.</strong><p>Make a list for a real task, then check each item against current merchant listings.</p><Link href="/lists" className="live-button">Create a list</Link></div>}
      </section> },
      { id: "price-alerts", label: "Price alerts", node: <section aria-labelledby="price-alerts-title">
        <div className="live-section-heading"><div><div className="live-eyebrow">Current records only</div><h2 id="price-alerts-title" className="live-section-title">Price alerts you follow</h2></div><Link className="live-text-link" href="/my-live">Manage alerts <ArrowRight size={15} /></Link></div>
        {activeAlerts.length ? <div className="live-personal-row">{activeAlerts.map((alert) => <div key={alert.id} className="live-personal-card"><span className="live-personal-icon"><Activity size={18} /></span><span><strong>{alert.product?.name || alert.query || "Search price alert"}</strong><small>{alert.lastTriggeredAt ? `Last triggered ${dateLabel(alert.lastTriggeredAt)}` : "No trigger recorded yet"} · target {formatNaira(alert.thresholdKobo)}</small></span></div>)}</div> : <div className="live-empty-card"><strong>No price alerts yet.</strong><p>When set up, they are evaluated against recorded merchant prices only. Historical prices are never invented.</p><Link href="/search" className="live-button">Find a product</Link></div>}
      </section> },
    );
  }

  return <div className="min-h-screen">
    <Header user={user} />
    <main className="live-wrap live-main">
      {locationError && <p className="live-home-location-error" role="status">{locationError} Results have not been widened automatically. Choose a new location in the header.</p>}
      <section className="live-home-hero" aria-labelledby="home-title">
        <div className="live-home-hero-content">
          <div className="live-eyebrow"><span className="live-brand-dot" /> Live · {locationName || "Nationwide Nigeria"}</div>
          <h1 id="home-title">Everything You Need.<br /><span>All in One Place.</span></h1>
          <p>Shop. Sell. Service. Grow. Explore currently supported merchant listings, compare posted details and availability notes, then choose your next step.</p>
          <SearchHero />
          <div className="live-hero-trust"><MapPin size={16} aria-hidden="true" /><span>Choose any Nigerian state, the FCT, or a supported locality manually. No GPS is required; location support does not imply merchant coverage.</span></div>
        </div>
        <aside className="live-home-hero-aside" aria-label="How Live works">
          <div className="live-hero-aside-kicker">Made for real-world availability</div>
          <div className="live-hero-step"><span>01</span><div><strong>Search current listings</strong><small>Prices and quantities come from merchant records.</small></div></div>
          <div className="live-hero-step"><span>02</span><div><strong>Compare with context</strong><small>See area, freshness and pickup terms.</small></div></div>
          <div className="live-hero-step"><span>03</span><div><strong>Reserve with a recheck</strong><small>Stock is revalidated by the server. Pending is not confirmed.</small></div></div>
          <Link href="/search" className="live-hero-aside-link">Search Live <ArrowRight size={16} /></Link>
        </aside>
      </section>
      <HomeSections sections={sections} userId={user?.id} initialLayout={user?.homeSections} />
    </main>
    <BrandFooter />
    {process.env.ASSIST_ENABLED !== "false" && <AssistWidget />}
    <BottomNav pathname="/" />
  </div>;
}
