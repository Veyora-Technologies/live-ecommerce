import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPublicMarketplaceProduct, publicMarketplaceProductIds } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration } from "@/lib/market-config";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const rows = await prisma.recentView.findMany({
    where: { userId: user.id, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
    select: {
      id: true,
      productId: true,
      viewedAt: true,
      product: { select: { id: true, name: true, imageUrl: true, currency: true, merchant: { select: { id: true, businessName: true, area: true } } } },
    },
    orderBy: { viewedAt: "desc" },
    take: 20,
  });
  const publicIds = await publicMarketplaceProductIds(rows.map((view) => view.productId));
  return NextResponse.json({ recentViews: rows.filter((view) => publicIds.has(view.productId)) }, { headers: privateHeaders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const body = await req.json().catch(() => null);
  const parsed = z.object({ productId: z.string().min(1).max(40) }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Valid productId required" }, { status: 400, headers: privateHeaders });
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, archived: false, merchant: { status: "APPROVED" } }, select: { id: true } });
  if (!product || !await isPublicMarketplaceProduct(product.id)) return NextResponse.json({ error: "Product not found" }, { status: 404, headers: privateHeaders });
  await prisma.recentView.upsert({
    where: { userId_productId: { userId: user.id, productId: product.id } },
    create: { userId: user.id, productId: product.id },
    update: { viewedAt: new Date() },
  });
  return NextResponse.json({ ok: true }, { status: 200, headers: privateHeaders });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  await prisma.recentView.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true }, { headers: privateHeaders });
}
