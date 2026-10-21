import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Header, BottomNav } from "@/components/Header";
import { formatNaira } from "@/lib/utils";
import Link from "next/link";
import { redirect } from "next/navigation";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration } from "@/lib/market-config";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/saved");
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const savedRows = await prisma.savedItem.findMany({
    where: { userId: user.id, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
    select: { id: true, productId: true, product: { select: { id: true, name: true, price: true, currency: true, imageUrl: true, merchant: { select: { businessName: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const publicIds = await publicMarketplaceProductIds(savedRows.flatMap((item) => item.productId ? [item.productId] : []));
  const saved = savedRows.filter((item) => Boolean(item.productId && publicIds.has(item.productId)));
  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="mx-auto max-w-[800px] px-4 py-6 pb-24">
        <h1 className="font-black text-2xl">Saved</h1>
        <p className="text-sm text-slate-500">Your favourite public marketplace products. Availability is not confirmed by saving.</p>
        {saved.length === 0 ? (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-3xl">♡</div>
            <div className="font-bold mt-2">Nothing saved yet</div>
            <div className="text-sm text-slate-500">Tap the heart on a public product listing to save it for later.</div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {saved.map((item) => item.product && (
              <Link key={item.id} href={`/product/${item.product.id}`} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-36 w-full object-cover" /> : <div aria-hidden="true" className="h-36 w-full bg-slate-100" />}
                <div className="p-3">
                  <div className="text-sm font-semibold line-clamp-1">{item.product.name}</div>
                  <div className="text-xs text-slate-500">{item.product.merchant.businessName}</div>
                  <div className="font-black">{formatNaira(item.product.price)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <BottomNav pathname="/saved" />
    </div>
  );
}
