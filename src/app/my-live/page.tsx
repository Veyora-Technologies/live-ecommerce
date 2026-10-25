import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Header, BottomNav } from "@/components/Header";
import MyLiveClient from "./MyLiveClient";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration } from "@/lib/market-config";
import { reservationViewSelect } from "@/lib/reservation-view";

export const dynamic = "force-dynamic";

export default async function MyLivePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/my-live");
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];

  const [rawSavedItems, savedSearches, rawPriceAlerts, rawRecentViews, reservations, ownedLists, memberships] = await Promise.all([
    prisma.savedItem.findMany({
      where: { userId: user.id, productId: { not: null }, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
      select: { id: true, productId: true, createdAt: true, product: { select: { id: true, name: true, imageUrl: true, price: true, currency: true, merchant: { select: { businessName: true, area: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savedSearch.findMany({ where: { userId: user.id }, select: { id: true, query: true, filters: true, createdAt: true, alertEnabled: true, alertFrequency: true, label: true, lastNotifiedAt: true, lastEvaluatedAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.priceAlert.findMany({
      where: { userId: user.id, active: true, productId: { not: null }, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
      select: { id: true, productId: true, query: true, thresholdKobo: true, lastTriggeredAt: true, createdAt: true, product: { select: { id: true, name: true, price: true, currency: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.recentView.findMany({
      where: { userId: user.id, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
      select: { id: true, productId: true, viewedAt: true, product: { select: { id: true, name: true, imageUrl: true, currency: true, merchant: { select: { businessName: true, area: true } } } } },
      orderBy: { viewedAt: "desc" }, take: 20,
    }),
    prisma.reservation.findMany({ where: { consumerId: user.id }, select: reservationViewSelect, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.shoppingList.findMany({ where: { ownerId: user.id }, select: { id: true, ownerId: true, name: true, _count: { select: { items: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.shoppingListMember.findMany({ where: { userId: user.id }, select: { list: { select: { id: true, ownerId: true, name: true, _count: { select: { items: true } } } } } }),
  ]);

  const candidateProductIds = [
    ...rawSavedItems.flatMap((item) => item.productId ? [item.productId] : []),
    ...rawPriceAlerts.flatMap((alert) => alert.productId ? [alert.productId] : []),
    ...rawRecentViews.map((view) => view.productId),
  ];
  const publicIds = await publicMarketplaceProductIds([...new Set(candidateProductIds)]);
  const savedItems = rawSavedItems.filter((item) => Boolean(item.productId && publicIds.has(item.productId)));
  const priceAlerts = rawPriceAlerts.filter((alert) => Boolean(alert.productId && publicIds.has(alert.productId)));
  const recentViews = rawRecentViews.filter((view) => publicIds.has(view.productId));
  const lists = [...new Map([...ownedLists, ...memberships.map((member) => member.list)].map((list) => [list.id, { ...list, isOwner: list.ownerId === user.id }])).values()];

  return <div className="min-h-screen">
    <Header user={user} />
    <main className="live-wrap live-main live-my-live-page">
      <div className="live-my-live-intro">
        <div><div className="live-eyebrow">Your account, your utility</div><h1>My Furnivo</h1><p>Saved discoveries and real transaction records in one place. Saved listings are not availability confirmations.</p></div>
        <a className="live-button live-button-primary" href="/search">Search Furnivo</a>
      </div>
      <MyLiveClient
        savedItems={JSON.parse(JSON.stringify(savedItems))}
        savedSearches={JSON.parse(JSON.stringify(savedSearches))}
        priceAlerts={JSON.parse(JSON.stringify(priceAlerts))}
        recentViews={JSON.parse(JSON.stringify(recentViews))}
        reservations={JSON.parse(JSON.stringify(reservations))}
        lists={JSON.parse(JSON.stringify(lists))}
      />
    </main>
    <BottomNav pathname="/my-live" />
  </div>;
}
