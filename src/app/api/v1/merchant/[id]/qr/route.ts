import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const merchant = await prisma.merchant.findFirst({ where: { id, status: "APPROVED" }, select: { id: true, businessName: true } });
  if (!merchant) return NextResponse.json({ error: "Public merchant profile not found" }, { status: 404 });
  const url = new URL(`/merchant/${merchant.id}`, req.nextUrl.origin).toString();
  const qrImageUrl = await QRCode.toDataURL(url, { width: 300, margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({
    merchantId: merchant.id,
    businessName: merchant.businessName,
    url,
    qrImageUrl,
    note: "Scan to open the public merchant profile. QR is for discovery only, not payment or authentication.",
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
