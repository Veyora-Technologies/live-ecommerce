import { NextRequest, NextResponse } from "next/server";
import { compareProducts } from "@/lib/compare-products";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawLat = params.get("lat")?.trim();
  const rawLng = params.get("lng")?.trim();
  const result = await compareProducts({
    productName: params.get("productName") || params.get("name") || params.get("q") || "",
    ids: params.get("ids")?.split(","),
    category: params.get("category") || "",
    area: params.get("area") || "",
    lat: rawLat ? Number(rawLat) : undefined,
    lng: rawLng ? Number(rawLng) : undefined,
  });
  return NextResponse.json(result, { status: "error" in result ? (result.code === "LEGAL_RELEASE_GATE" ? 503 : 400) : 200, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) { return GET(req); }
