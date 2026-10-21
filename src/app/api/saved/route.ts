import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPublicMarketplaceProduct, publicMarketplaceProductIds } from "@/lib/marketplace";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ saved: [] }, { headers: privateHeaders });
  const rows = await prisma.savedItem.findMany({
    where: { userId: user.id, product: { archived: false, merchant: { status: "APPROVED" } } },
    select: {
      id: true,
      productId: true,
      createdAt: true,
      product: { select: { id: true, name: true, price: true, currency: true, imageUrl: true, merchant: { select: { id: true, businessName: true, area: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const publicIds = await publicMarketplaceProductIds(rows.flatMap((item) => item.productId ? [item.productId] : []));
  return NextResponse.json({ saved: rows.filter((item) => Boolean(item.productId && publicIds.has(item.productId))) }, { headers: privateHeaders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const body = await req.json().catch(() => null);
  const productId = body && typeof body === "object" && !Array.isArray(body) && typeof body.productId === "string" ? body.productId.trim() : "";
  if (!productId || productId.length > 40) return NextResponse.json({ error: "Valid productId required" }, { status: 400, headers: privateHeaders });
  if (!await isPublicMarketplaceProduct(productId)) return NextResponse.json({ error: "Public product listing not found" }, { status: 404, headers: privateHeaders });
  try {
    const saved = await prisma.savedItem.create({ data: { userId: user.id, productId } });
    return NextResponse.json({ saved }, { status: 201, headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "Already saved" }, { status: 409, headers: privateHeaders });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId || productId.length > 40) return NextResponse.json({ error: "Valid productId required" }, { status: 400, headers: privateHeaders });
  await prisma.savedItem.deleteMany({ where: { userId: user.id, productId } });
  return NextResponse.json({ ok: true }, { headers: privateHeaders });
}
