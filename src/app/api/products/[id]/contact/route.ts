import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";
import { logSecurityEvent } from "@/lib/security";
import { merchantRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/**
 * Contact details are not included in public product/merchant responses.
 * They are released here only to a signed-in caller, and every release is
 * audited so merchant contact data cannot be harvested by unauthenticated
 * scraping. The app's existing masked call/WhatsApp buttons use the same
 * endpoint to obtain the number for the active action.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to view merchant contact details.", code: "SIGN_IN_REQUIRED" },
      { status: 401, ...noStore },
    );
  }

  if (!await isPublicMarketplaceProduct(id)) {
    return NextResponse.json({ error: "Contact details are unavailable for this listing." }, { status: 404, ...noStore });
  }

  const product = await prisma.product.findFirst({
    where: { id, archived: false, merchant: { status: "APPROVED" } },
    select: {
      id: true,
      merchantId: true,
      merchant: { select: { id: true, businessName: true, phone: true, whatsapp: true, email: true, ownerId: true } },
    },
  });
  if (!product) return NextResponse.json({ error: "Contact details are unavailable for this listing." }, { status: 404, ...noStore });

  // Owners and staff may always read their own store's details.
  const staffRole = await merchantRole(product.merchantId, user.id);
  const isStaff = staffRole !== null;

  await logSecurityEvent("MERCHANT_CONTACT_REVEAL", {
    userId: user.id,
    headers: _req.headers,
    metadata: { merchantId: product.merchantId, productId: product.id, staff: isStaff },
  });

  return NextResponse.json({
    merchantId: product.merchant.id,
    businessName: product.merchant.businessName,
    phone: product.merchant.phone,
    whatsapp: product.merchant.whatsapp,
    email: product.merchant.email,
    note: "Contact details are provided by the merchant and are released to signed-in accounts only. Furnivo does not verify them or arrange delivery.",
  }, noStore);
}
