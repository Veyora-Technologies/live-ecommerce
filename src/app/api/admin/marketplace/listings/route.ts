import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMarketplaceWorkflowImplemented, publicMarketplaceCategoryWhere, safeListingImageUrl } from "@/lib/marketplace";
import { getLegalReleaseGate, isLegalProductionMode, requirePolicyAcceptancesInTransaction } from "@/lib/legal";

export const dynamic = "force-dynamic";

async function requireMarketplaceReviewer() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return null;
  const admin = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  return admin && ["REVIEWER", "SUPER"].includes(admin.adminRole || "") ? user : null;
}

export async function GET() {
  const user = await requireMarketplaceReviewer();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await prisma.marketplaceListing.findMany({
    where: {
      lifecycleStatus: "PENDING_REVIEW",
      moderationStatus: "PENDING",
      category: { is: publicMarketplaceCategoryWhere() },
    },
    select: {
      id: true,
      merchantId: true,
      sellerUserId: true,
      listingKind: true,
      lifecycleStatus: true,
      moderationStatus: true,
      title: true,
      description: true,
      priceModel: true,
      priceAmountMinor: true,
      currencyCode: true,
      priceUnit: true,
      createdAt: true,
      category: { select: { slug: true, name: true, listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true } },
      merchant: { select: { id: true, businessName: true, status: true, area: true, city: true, stateCode: true } },
      media: { where: { isPrimary: true }, select: { url: true, altText: true }, take: 1 },
      product: { select: { id: true, name: true, category: true, brand: true, archived: true, merchant: { select: { status: true } } } },
      service: { select: { id: true, name: true, durationMin: true, capacity: true, merchant: { select: { status: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const sellerPolicy = isLegalProductionMode() ? await prisma.legalPolicy.findFirst({ where: { key: "SELLER_AGREEMENT", status: "PUBLISHED", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" }, select: { id: true } }) : null;
  const sellerAcceptances = sellerPolicy ? await prisma.legalPolicyAcceptance.findMany({ where: { policyId: sellerPolicy.id, action: "ACCEPTED", merchantId: { not: null } }, select: { merchantId: true, userId: true } }) : [];
  const acceptedPairs = new Set(sellerAcceptances.flatMap((item) => item.merchantId ? [`${item.merchantId}:${item.userId}`] : []));
  const listings = rows.filter((row) => isMarketplaceWorkflowImplemented(row.category)).map((row) => {
    const sellerAgreementAccepted = !isLegalProductionMode() || Boolean(row.merchantId && acceptedPairs.has(`${row.merchantId}:${row.sellerUserId}`));
    const publicRow = { ...row, sellerAgreementAccepted };
    Reflect.deleteProperty(publicRow, "merchantId");
    Reflect.deleteProperty(publicRow, "sellerUserId");
    return {
      ...publicRow,
      media: row.media.flatMap((item) => {
        const url = safeListingImageUrl(item.url);
        return url ? [{ ...item, url }] : [];
      }),
      priceAmountMinor: row.priceAmountMinor?.toString() ?? null,
    };
  });
  return NextResponse.json({ listings }, { headers: { "Cache-Control": "private, no-store" } });
}

const moderationSchema = z.object({
  id: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional().default(""),
}).strict();

export async function PATCH(request: NextRequest) {
  const user = await requireMarketplaceReviewer();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = moderationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid listing action." }, { status: 400 });
  const { id, action, reason } = parsed.data;
  if (action === "approve") {
    const gate = await getLegalReleaseGate("MARKETPLACE");
    if (!gate.ready) return NextResponse.json({ error: gate.publicMessage, code: "LEGAL_RELEASE_GATE" }, { status: 503 });
  }
  if (action === "reject" && reason.length < 2) return NextResponse.json({ error: "A reason of at least 2 characters is required to reject a listing." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.marketplaceListing.findUnique({
        where: { id },
        include: {
          category: true,
          product: { select: { archived: true, merchant: { select: { id: true, ownerId: true, status: true } } } },
          service: { select: { merchant: { select: { id: true, ownerId: true, status: true } } } },
        },
      });
      if (!current) return { error: "Listing not found.", status: 404 as const };
      if (current.lifecycleStatus !== "PENDING_REVIEW" || current.moderationStatus !== "PENDING") return { error: "This listing is no longer awaiting review. Refresh the queue before retrying.", status: 409 as const };
      if (!isMarketplaceWorkflowImplemented(current.category)) return { error: "The category workflow is no longer enabled for marketplace review.", status: 409 as const };
      if (action === "approve") {
        const seller = current.product?.merchant ?? current.service?.merchant;
        const merchantStatus = seller?.status;
        if (merchantStatus !== "APPROVED" || current.product?.archived) return { error: "The seller must be platform-approved and the product must be active before listing approval.", status: 409 as const };
        if ((!current.product && !current.service) || (current.product && current.service) || !seller) return { error: "The listing is not linked to exactly one supported product or service workflow.", status: 409 as const };
        const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: seller.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: seller.id });
        if (!sellerPolicy.allowed) return { error: "The business owner has not accepted the current seller agreement for this merchant.", status: 409 as const };
      }

      const nextStatus = action === "approve" ? "PUBLISHED" : "REJECTED";
      const moderationStatus = action === "approve" ? "APPROVED" : "REJECTED";
      const changed = await tx.marketplaceListing.updateMany({
        where: { id, lifecycleStatus: "PENDING_REVIEW", moderationStatus: "PENDING" },
        data: { lifecycleStatus: nextStatus, moderationStatus, transactionEligible: action === "approve", publishedAt: action === "approve" ? new Date() : null },
      });
      if (changed.count !== 1) return { error: "Another reviewer changed this listing first. Refresh the queue.", status: 409 as const };

      await tx.marketplaceListingEvent.create({ data: {
        listingId: id,
        actorId: user.id,
        eventType: action === "approve" ? "LISTING_MODERATION_APPROVED" : "LISTING_MODERATION_REJECTED",
        fromStatus: current.lifecycleStatus,
        toStatus: nextStatus,
        reason: reason || (action === "approve" ? "Reviewed and approved" : "Rejected"),
      } });
      await tx.auditLog.create({ data: {
        actorId: user.id,
        action: `MARKETPLACE_LISTING_${action.toUpperCase()}`,
        resourceType: "MarketplaceListing",
        resourceId: id,
        outcome: nextStatus,
        metadata: reason ? reason.slice(0, 500) : "reviewed",
      } });
      return { ok: true, id, lifecycleStatus: nextStatus, moderationStatus } as const;
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The listing review could not be saved. No approval was confirmed." }, { status: 500 });
  }
}
