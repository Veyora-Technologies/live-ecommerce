import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  if (!admin || !["REVIEWER", "SUPER"].includes(admin.adminRole || "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const categories = await prisma.marketplaceCategory.findMany({
    select: { id: true, slug: true, name: true, listingKind: true, workflowKey: true, readinessStatus: true, enabledForNewListings: true, visibleInSearch: true, requiresReview: true, requiresSellerVerification: true, schemaVersion: true, parent: { select: { name: true, slug: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ categories }, { headers: { "Cache-Control": "private, no-store" } });
}
