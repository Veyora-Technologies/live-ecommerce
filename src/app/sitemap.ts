import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { getLegalReleaseGate, isLegalProductionMode } from "@/lib/legal";
import { isMarketplaceWorkflowImplemented, publicMarketplaceCategoryWhere } from "@/lib/marketplace";
import { getPublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return [];
  const gate = await getLegalReleaseGate("MARKETPLACE");
  if (!gate.ready) return [];

  const listings = await prisma.marketplaceListing.findMany({
    where: {
      lifecycleStatus: "PUBLISHED",
      moderationStatus: "APPROVED",
      visibility: "PUBLIC",
      transactionEligible: true,
      category: { is: publicMarketplaceCategoryWhere() },
    },
    select: {
      id: true,
      productId: true,
      serviceId: true,
      merchantId: true,
      sellerUserId: true,
      updatedAt: true,
      publishedAt: true,
      category: { select: { listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 50_000,
  });
  let eligible = listings.filter((listing) => isMarketplaceWorkflowImplemented(listing.category));
  if (isLegalProductionMode()) {
    const policy = await prisma.legalPolicy.findFirst({ where: { key: "SELLER_AGREEMENT", status: "PUBLISHED", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" }, select: { id: true } });
    const acceptances = policy ? await prisma.legalPolicyAcceptance.findMany({ where: { policyId: policy.id, action: "ACCEPTED", merchantId: { not: null } }, select: { merchantId: true, userId: true } }) : [];
    const acceptedPairs = new Set(acceptances.flatMap((item) => item.merchantId ? [`${item.merchantId}:${item.userId}`] : []));
    eligible = eligible.filter((listing) => Boolean(listing.merchantId && acceptedPairs.has(`${listing.merchantId}:${listing.sellerUserId}`)));
  }

  const productEntries: MetadataRoute.Sitemap = eligible.flatMap((listing) => listing.productId ? [{
    url: `${baseUrl}/product/${encodeURIComponent(listing.productId)}`,
    lastModified: listing.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }] : []);
  const merchantIds = [...new Set(eligible.flatMap((listing) => listing.merchantId ? [listing.merchantId] : []))];
  const merchants = merchantIds.length ? await prisma.merchant.findMany({ where: { id: { in: merchantIds }, status: "APPROVED" }, select: { id: true, updatedAt: true }, take: 50_000 }) : [];
  const merchantEntries: MetadataRoute.Sitemap = merchants.map((merchant) => ({
    url: `${baseUrl}/merchant/${encodeURIComponent(merchant.id)}`,
    lastModified: merchant.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  return [
    { url: `${baseUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/marketplace`, changeFrequency: "daily", priority: 0.9 },
    ...productEntries,
    ...merchantEntries,
  ];
}
