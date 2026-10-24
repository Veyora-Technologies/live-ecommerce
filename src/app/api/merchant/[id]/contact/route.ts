import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logSecurityEvent } from "@/lib/security";
import { merchantRole } from "@/lib/permissions";
import { DEFAULT_MARKET_CODE, merchantBelongsToMarket } from "@/lib/market-config";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/**
 * Merchant contact details for an approved public profile.
 *
 * Mirrors /api/products/[id]/contact: signed-in accounts only, every release is
 * audited, and the detail is never embedded in server-rendered HTML.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid merchant" }, { status: 400, ...noStore });

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to view merchant contact details.", code: "SIGN_IN_REQUIRED" },
      { status: 401, ...noStore },
    );
  }

  const merchant = await prisma.merchant.findFirst({
    where: { id, status: "APPROVED" },
    select: { id: true, businessName: true, phone: true, whatsapp: true, email: true, countryCode: true },
  });
  if (!merchant || !merchantBelongsToMarket(merchant, DEFAULT_MARKET_CODE)) {
    return NextResponse.json({ error: "Contact details are unavailable for this merchant." }, { status: 404, ...noStore });
  }

  const staffRole = await merchantRole(merchant.id, user.id);

  await logSecurityEvent("MERCHANT_CONTACT_REVEAL", {
    userId: user.id,
    headers: req.headers,
    metadata: { merchantId: merchant.id, staff: staffRole !== null },
  });

  return NextResponse.json({
    merchantId: merchant.id,
    businessName: merchant.businessName,
    phone: merchant.phone,
    whatsapp: merchant.whatsapp,
    email: merchant.email,
    note: "Contact details are provided by the merchant and are released to signed-in accounts only. Live does not verify them or arrange delivery.",
  }, noStore);
}
