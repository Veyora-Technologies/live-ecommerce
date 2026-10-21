import { prisma } from "@/lib/db";
import { formatNairaMinor } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getActiveMarketConfiguration } from "@/lib/market-config";

/** Trigger when a real approved merchant listing is at/below the user's target. */
export async function processPriceAlerts() {
  const supportedCurrencies = getActiveMarketConfiguration(DEFAULT_MARKET_CODE)?.supportedCurrencies.map((currency) => currency.code) ?? [];
  const alerts = await prisma.priceAlert.findMany({
    where: {
      active: true, productId: { not: null },
      product: { archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } },
    },
    include: { product: true, user: { include: { notificationPrefs: true } } },
    take: 1000, orderBy: { createdAt: "asc" },
  });
  let triggered = 0;
  let reset = 0;
  for (const alert of alerts) {
    if (!alert.product) continue;
    const below = alert.product.price <= alert.thresholdKobo;
    if (!below && alert.lastTriggeredAt) {
      const result = await prisma.priceAlert.updateMany({
        where: { id: alert.id, active: true, lastTriggeredAt: alert.lastTriggeredAt },
        data: { lastTriggeredAt: null },
      });
      reset += result.count;
      continue;
    }
    if (!below || alert.lastTriggeredAt) continue;
    const prefs = alert.user.notificationPrefs;
    // Price alerts are opt-in (the schema default is false); missing preferences do not opt in.
    if (prefs?.pushEnabled === false || prefs?.alertsForPriceChange !== true) continue;

    const didTrigger = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id: alert.productId!, archived: false, currency: { in: supportedCurrencies }, merchant: { status: "APPROVED" } },
        select: { id: true, name: true, price: true },
      });
      if (!current || current.price > alert.thresholdKobo) return false;
      // Claim atomically so overlapping scheduler runs cannot duplicate a notification.
      const claim = await tx.priceAlert.updateMany({
        where: { id: alert.id, active: true, lastTriggeredAt: null },
        data: { lastTriggeredAt: new Date() },
      });
      if (claim.count !== 1) return false;
      await tx.notification.create({
        data: {
          recipientId: alert.userId,
          type: "PRICE_ALERT",
          title: "Price target reached",
          body: `${current.name} is listed at ${formatNairaMinor(current.price)} (your target ${formatNairaMinor(alert.thresholdKobo)}). This is a current merchant listing, not a price-history claim.`,
          resourceType: "Product",
          resourceId: current.id,
        },
      });
      return true;
    });
    if (didTrigger) triggered++;
  }
  return { evaluated: alerts.length, triggered, reset };
}
