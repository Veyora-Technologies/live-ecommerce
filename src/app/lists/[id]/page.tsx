import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/Header";
import { notFound, redirect } from "next/navigation";
import ListDetail from "./ListDetail";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { formatNaira } from "@/lib/utils";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration, getMarketCurrencyConfiguration } from "@/lib/market-config";
export const dynamic = "force-dynamic";

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/lists/${id}`)}`);

  const list = await prisma.shoppingList.findFirst({
    where: { id, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    select: {
      id: true,
      name: true,
      description: true,
      spendingLimit: true,
      items: {
        select: {
          id: true,
          productId: true,
          customName: true,
          quantity: true,
          checked: true,
          product: {
            select: {
              id: true,
              name: true,
              category: true,
              price: true,
              currency: true,
              availability: true,
              stockQuantity: true,
              reservedQuantity: true,
              lastConfirmedAt: true,
              updatedAt: true,
              merchant: { select: { businessName: true, area: true } },
            },
          },
        },
      },
      members: { select: { userId: true, role: true, user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!list) notFound();

  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const productRows = await prisma.product.findMany({
    where: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } }, 
    take: 100,
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, price: true, merchant: { select: { businessName: true } } },
  });
  const publicProductIds = await publicMarketplaceProductIds(productRows.map((product) => product.id));
  const products = productRows.filter((product) => publicProductIds.has(product.id)).slice(0, 24);
  const safeList = {
    ...list,
    items: list.items.map((item) => {
      if (!item.product) return item;
      const currencyCode = item.product.currency || DEFAULT_MARKET_CODE;
      const priceAvailable = Boolean(getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, currencyCode));
      return { ...item, product: { ...item.product, currencyCode, priceAvailable, price: priceAvailable ? item.product.price : null } };
    }),
  };

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <main className="mx-auto max-w-[900px] px-4 py-6">
        <Link href="/lists" className="text-sm text-slate-600">← All lists</Link>
        <h1 className="mt-2 font-black text-2xl">{list.name}</h1>
        <p className="text-sm text-slate-500">{list.description || ""}{list.spendingLimit ? ` • Limit ${formatNaira(list.spendingLimit)}` : ""}</p>
        <ListDetail initial={JSON.parse(JSON.stringify(safeList))} products={JSON.parse(JSON.stringify(products))} />
      </main>
    </div>
  );
}
