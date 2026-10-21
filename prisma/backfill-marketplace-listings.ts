import { PrismaClient } from "@prisma/client";
import { syncProductMarketplaceListing, syncServiceMarketplaceListing } from "../src/lib/marketplace";

const prisma = new PrismaClient();

function assertBackfillAllowed() {
  const demoOptIn = process.env.LIVE_DATA_MODE === "demo" && process.env.LIVE_ALLOW_DEMO_SEED === "1" && process.env.NODE_ENV !== "production";
  const explicitProductionOptIn = process.env.LIVE_MARKETPLACE_BACKFILL === "1";
  if (!demoOptIn && !explicitProductionOptIn) {
    throw new Error("Refusing marketplace projection backfill. Use an isolated demo SQLite fixture or explicitly set LIVE_MARKETPLACE_BACKFILL=1 after a reviewed schema migration and backup.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
}

async function main() {
  assertBackfillAllowed();
  let products = 0;
  let services = 0;
  let productCursor: string | undefined;
  let serviceCursor: string | undefined;

  while (true) {
    const rows = await prisma.product.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(productCursor ? { cursor: { id: productCursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      await prisma.$transaction((tx) => syncProductMarketplaceListing(tx, row.id));
      products++;
    }
    productCursor = rows.at(-1)!.id;
  }

  while (true) {
    const rows = await prisma.service.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(serviceCursor ? { cursor: { id: serviceCursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      await prisma.$transaction((tx) => syncServiceMarketplaceListing(tx, row.id));
      services++;
    }
    serviceCursor = rows.at(-1)!.id;
  }

  console.log(`Marketplace projection backfill complete: products=${products}, services=${services}. Source inventory/service rows were not changed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
