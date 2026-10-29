import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processPriceAlerts } from "@/lib/price-alerts";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration, getMarketCurrencyConfiguration } from "@/lib/market-config";

const createSchema = z.object({
  productId: z.string().min(1).max(40),
  targetPrice: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  thresholdKobo: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
}).strict().refine((value) => value.targetPrice !== undefined || value.thresholdKobo !== undefined, { message: "targetPrice in kobo is required" });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const alerts = await prisma.priceAlert.findMany({
    where: { userId: user.id, active: true, productId: { not: null }, product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } } },
    include: { product: { select: { id: true, name: true, price: true, currency: true, merchantId: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ alerts: alerts.map((alert) => ({ ...alert, currencyCode: alert.product?.currency ?? null, currentPrice: alert.product?.price ?? null })) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid productId and targetPrice in kobo are required" }, { status: 400 });
  const thresholdKobo = parsed.data.targetPrice ?? parsed.data.thresholdKobo!;
  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, archived: false, merchant: { status: "APPROVED" } },
    select: { id: true, currency: true },
  });
  if (!product || !await isPublicMarketplaceProduct(product.id)) return NextResponse.json({ error: "Public product listing not found" }, { status: 404 });
  if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Price alerts are not available for this listing's currency in the active market. Furnivo has not converted the amount.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const existing = await prisma.priceAlert.findFirst({ where: { userId: user.id, productId: product.id, thresholdKobo, active: true } });
  if (existing) return NextResponse.json({ alert: existing, note: "This in-app price target is already active; no duplicate was created." });
  const alert = await prisma.priceAlert.create({ data: { userId: user.id, productId: product.id, thresholdKobo } });
  return NextResponse.json({ alert, note: "Target saved. In-app evaluation requires your price-change and in-app notification preferences plus a configured scheduler; no historical price is inferred." }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = z.object({ id: z.string().min(1).max(40) }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  const updated = await prisma.priceAlert.updateMany({ where: { id: parsed.data.id, userId: user.id, active: true }, data: { active: false } });
  if (!updated.count) return NextResponse.json({ error: "Price alert not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Scheduler-only endpoint. CRON_SECRET must be configured; absence fails closed. */
export async function PUT(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-cron-secret") !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await processPriceAlerts());
}
