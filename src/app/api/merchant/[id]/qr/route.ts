import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

/** Local QR image for a public merchant profile; discovery only, never payment/auth. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 40) return NextResponse.json({ error: "Invalid merchant" }, { status: 400 });
  const merchant = await prisma.merchant.findFirst({ where: { id, status: "APPROVED" }, select: { id: true, businessName: true } });
  if (!merchant) return NextResponse.json({ error: "Public merchant profile not found" }, { status: 404 });
  const url = new URL(`/merchant/${merchant.id}`, req.nextUrl.origin).toString();
  const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({ qrDataUrl, url, merchant: merchant.businessName }, { headers: { "Cache-Control": "private, no-store" } });
}
