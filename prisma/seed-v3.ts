/**
 * Additive Live 3.0 sample seed (labelled sample data):
 * admin roles, freshness policies, variants, batches, a promotion,
 * an operating exception and a price alert.
 */
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedAllowed } from "./seed-safety";
const prisma = new PrismaClient();

async function main() {
  assertDemoSeedAllowed("Live 3.0 additive sample seed");
  await prisma.user.updateMany({ where:{ email: "admin@live.ng" }, data:{ adminRole: "SUPER" } });

  for (const [category, stale, recent] of [
    ["Pharmacy", 12, 4], ["Grocery", 24, 6], ["Essentials", 48, 12],
    ["Electronics", 72, 24], ["Service", 72, 24],
  ] as const) {
    await prisma.freshnessPolicy.upsert({ where:{ category }, create:{ category, staleAfterHours: stale, recentHours: recent }, update:{ staleAfterHours: stale, recentHours: recent } });
  }

  const products = await prisma.product.findMany({ take: 80, include:{ merchant: true } });
  const rice = products.find(p => /rice/i.test(p.name));
  const paracetamol = products.find(p => /Paracetamol/.test(p.name));
  const indomie = products.find(p => /indomie/i.test(p.name));

  if (rice) {
    for (const v of [
      { name: "10kg bag", attributes: JSON.stringify({ unit: "10kg" }), priceDelta: 0, stockQuantity: 12 },
      { name: "25kg bag", attributes: JSON.stringify({ unit: "25kg" }), priceDelta: 18000, stockQuantity: 5 },
      { name: "50kg bag", attributes: JSON.stringify({ unit: "50kg" }), priceDelta: 42000, stockQuantity: 2 },
    ]) {
      if (!(await prisma.productVariant.findFirst({ where:{ productId: rice.id, name: v.name } })))
        await prisma.productVariant.create({ data:{ productId: rice.id, ...v } });
    }
    if (!(await prisma.promotion.findFirst({ where:{ productId: rice.id } })))
      await prisma.promotion.create({ data:{ productId: rice.id, merchantId: rice.merchantId, createdBy: rice.merchant.ownerId, promoPrice: Math.max(1, rice.price - 500), validFrom: new Date(), validUntil: new Date(Date.now() + 3 * 86400000) } });
    await prisma.product.update({ where:{ id: rice.id }, data:{ availabilityMethod: "MANUAL_EXACT_COUNT", dataSource: "MANUAL", unitType: "BAG" } });
  }
  if (paracetamol) {
    await prisma.product.update({ where:{ id: paracetamol.id }, data:{ availabilityMethod: "MANUAL_RANGE", dataSource: "MANUAL", unitType: "PACK", requiresConfirmation: true } });
    const existing = await prisma.productBatch.count({ where:{ productId: paracetamol.id } });
    if (!existing) {
      await prisma.productBatch.create({ data:{ productId: paracetamol.id, merchantId: paracetamol.merchantId, lotId: "SAMPLE-B24-001", quantity: 4, expiresAt: new Date(Date.now() + 180 * 86400000), status: "ACTIVE", recallNote: "Sample batch record (demo data)" } });
      await prisma.productBatch.create({ data:{ productId: paracetamol.id, merchantId: paracetamol.merchantId, lotId: "SAMPLE-B23-OLD", quantity: 1, expiresAt: new Date(Date.now() - 10 * 86400000), status: "ACTIVE", recallNote: "Sample expired batch — excluded from reservable stock automatically" } });
    }
  }

  const merchant = products[0]?.merchant;
  if (merchant) {
    const branches = await prisma.branch.findMany({ where:{ merchantId: merchant.id } });
    if (branches.length) await prisma.branch.updateMany({ where:{ merchantId: merchant.id }, data:{ timezone: "Africa/Lagos", hoursConfirmedAt: new Date() } });
    const d = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    if (!(await prisma.operatingException.findFirst({ where:{ merchantId: merchant.id, date: d } })))
      await prisma.operatingException.create({ data:{ merchantId: merchant.id, date: d, type: "CLOSED", note: "Sample public-holiday closure (demo data)" } });
  }

  const aminu = await prisma.user.findFirst({ where:{ email: "aminu@example.com" } });
  if (aminu && indomie && !(await prisma.priceAlert.findFirst({ where:{ userId: aminu.id, productId: indomie.id } }))) {
    await prisma.priceAlert.create({ data:{ userId: aminu.id, productId: indomie.id, thresholdKobo: Math.max(1, indomie.price - 100) } });
  }
  console.log("seed-v3 complete (admin role, policies, variants, batches, promotion, exception, alert)");
}
main().finally(() => prisma.$disconnect());
