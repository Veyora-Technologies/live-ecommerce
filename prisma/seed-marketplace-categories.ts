import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CategorySeed = {
  slug: string;
  name: string;
  listingKind: string;
  workflowKey: string;
  parent?: string;
  readinessStatus?: string;
  enabledForNewListings?: boolean;
  visibleInSearch?: boolean;
  requiresReview?: boolean;
  requiresSellerVerification?: boolean;
  sortOrder?: number;
};

// Only the existing merchant inventory and service-booking workflows are ready in V10's
// foundation slice. Future verticals are deliberately staged, not publicly enabled.
const categories: CategorySeed[] = [
  // Merchant platform approval is enforced for these existing workflows. Independent seller-identity verification is not required or represented as complete by this marketplace slice.
  { slug: "products", name: "Products", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", readinessStatus: "READY", enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: false, sortOrder: 10 },
  { slug: "services", name: "Services", listingKind: "SERVICE", workflowKey: "SERVICE_BOOKING", readinessStatus: "READY", enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: false, sortOrder: 20 },

  { slug: "phones-electronics", name: "Phones and electronics", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 10 },
  { slug: "computers-office-equipment", name: "Computers and office equipment", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 20 },
  { slug: "home-appliances", name: "Home appliances", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 30 },
  { slug: "clothing-fashion", name: "Clothing and fashion", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 40 },
  { slug: "shoes-bags", name: "Shoes and bags", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 50 },
  { slug: "furniture-home", name: "Furniture and home", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 60 },
  { slug: "food-groceries", name: "Food and groceries", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 70 },
  { slug: "beauty-personal-care", name: "Beauty and personal care", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 80 },
  { slug: "books-education", name: "Books and education", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 90 },
  { slug: "sports-toys-hobbies", name: "Sports, toys and hobbies", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 100 },
  { slug: "building-tools-hardware", name: "Building materials, tools and hardware", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 110 },
  { slug: "auto-parts", name: "Auto parts", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 120 },
  { slug: "art-collectibles", name: "Art and collectibles", listingKind: "PRODUCT", workflowKey: "PRODUCT_INVENTORY", parent: "products", sortOrder: 130 },

  { slug: "real-estate-property", name: "Real estate and property", listingKind: "PROPERTY", workflowKey: "PROPERTY_DUE_DILIGENCE", sortOrder: 200 },
  { slug: "land-parcels", name: "Land and parcels", listingKind: "PROPERTY", workflowKey: "LAND_TITLE_REVIEW", parent: "real-estate-property", sortOrder: 10 },
  { slug: "residential-property", name: "Residential property", listingKind: "PROPERTY", workflowKey: "PROPERTY_DUE_DILIGENCE", parent: "real-estate-property", sortOrder: 20 },
  { slug: "commercial-industrial-property", name: "Commercial and industrial property", listingKind: "PROPERTY", workflowKey: "PROPERTY_DUE_DILIGENCE", parent: "real-estate-property", sortOrder: 30 },
  { slug: "vehicles-transport", name: "Vehicles and transport assets", listingKind: "VEHICLE", workflowKey: "VEHICLE_INSPECTION", sortOrder: 210 },
  { slug: "rentals-leasing", name: "Rentals and leasing", listingKind: "RENTAL", workflowKey: "RENTAL_BOOKING", sortOrder: 220 },
  { slug: "digital-products", name: "Digital products and licensed services", listingKind: "DIGITAL", workflowKey: "DIGITAL_RIGHTS_REVIEW", sortOrder: 230 },
  { slug: "agriculture-farm", name: "Agriculture and farm supply", listingKind: "AGRICULTURE", workflowKey: "AGRICULTURE_COMPLIANCE", sortOrder: 240 },
  { slug: "wholesale-b2b", name: "Wholesale and B2B sourcing", listingKind: "WHOLESALE", workflowKey: "B2B_QUOTATION", sortOrder: 250 },
  { slug: "industrial-equipment", name: "Industrial and commercial equipment", listingKind: "INDUSTRIAL", workflowKey: "INDUSTRIAL_ASSET_SALE", sortOrder: 260 },
  { slug: "event-tickets", name: "Events and registrations", listingKind: "EVENT", workflowKey: "EVENT_REGISTRATION", sortOrder: 270 },
  { slug: "public-procurement", name: "Authorized public tenders and procurement", listingKind: "PROCUREMENT", workflowKey: "TENDER_PUBLICATION", sortOrder: 280 },
  { slug: "business-transfers", name: "Business acquisitions and transfers", listingKind: "BUSINESS", workflowKey: "BUSINESS_TRANSFER_REVIEW", sortOrder: 290 },
  { slug: "individual-classifieds", name: "Individual seller listings", listingKind: "CLASSIFIED", workflowKey: "INDIVIDUAL_LISTING_REVIEW", sortOrder: 300 },
];

async function main() {
  // This seed is additive and contains taxonomy/configuration only: it creates no users,
  // products, merchants, credentials, transactions, or sample analytics, and deletes nothing.
  for (const category of categories) {
    const parent = category.parent
      ? await prisma.marketplaceCategory.findUnique({ where: { slug: category.parent }, select: { id: true } })
      : null;
    if (category.parent && !parent) throw new Error(`Missing parent category: ${category.parent}`);

    await prisma.marketplaceCategory.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        name: category.name,
        listingKind: category.listingKind,
        workflowKey: category.workflowKey,
        parentId: parent?.id ?? null,
        readinessStatus: category.readinessStatus ?? "PLANNED",
        enabledForNewListings: category.enabledForNewListings ?? false,
        visibleInSearch: category.visibleInSearch ?? false,
        requiresReview: category.requiresReview ?? true,
        requiresSellerVerification: category.requiresSellerVerification ?? true,
        sortOrder: category.sortOrder ?? 0,
        schemaVersion: 1,
      },
      // Do not silently overwrite operator changes on rerun. Readiness changes require
      // reviewed code and a deliberate schema/data migration.
      update: {},
    });
  }
  console.log(`Marketplace taxonomy ready: ${categories.length} categories added/verified; only the existing product and service workflows are enabled.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
