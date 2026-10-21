import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const AREA_OPTIONS = ["Wuse", "Garki", "Maitama", "Asokoro", "Wuye", "Jabi", "Utako", "Gwarimpa", "Kubwa", "Central Area"];
const layoutSchema = z.object({
  order: z.array(z.string().min(1).max(40)).max(16),
  hidden: z.array(z.string().min(1).max(40)).max(16),
}).strict();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ preferences: { theme: user.theme, preferredArea: user.preferredArea, preferredLocationCode: user.preferredLocationCode, homeSections: user.homeSections } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid preference payload" }, { status: 400 });

  const data: { theme?: string; preferredArea?: string | null; preferredLocationCode?: string | null; homeSections?: string } = {};
  if (Object.prototype.hasOwnProperty.call(body, "theme")) {
    if (!["system", "light", "dark"].includes(body.theme)) return NextResponse.json({ error: "theme must be system, light, or dark" }, { status: 400 });
    data.theme = body.theme;
  }
  if (Object.prototype.hasOwnProperty.call(body, "preferredArea")) {
    if (body.preferredArea !== null && (typeof body.preferredArea !== "string" || !AREA_OPTIONS.includes(body.preferredArea))) {
      return NextResponse.json({ error: "Select an available legacy area or clear it" }, { status: 400 });
    }
    data.preferredArea = body.preferredArea;
  }
  if (Object.prototype.hasOwnProperty.call(body, "preferredLocationCode")) {
    data.preferredArea = null; // clear the obsolete Abuja-only preference when a national location is set
    if (body.preferredLocationCode === null) data.preferredLocationCode = null;
    else {
      if (typeof body.preferredLocationCode !== "string" || body.preferredLocationCode.length > 64) {
        return NextResponse.json({ error: "Select a listed Nigerian location" }, { status: 400 });
      }
      const location = await prisma.geographicArea.findFirst({
        where: { code: body.preferredLocationCode, countryCode: "NG", active: true },
        select: { code: true },
      });
      if (!location) return NextResponse.json({ error: "That Nigerian location is unavailable" }, { status: 400 });
      data.preferredLocationCode = location.code;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "homeSections")) {
    const parsed = layoutSchema.safeParse(body.homeSections);
    if (!parsed.success || JSON.stringify(parsed.data).length > 1200) return NextResponse.json({ error: "Invalid home section preferences" }, { status: 400 });
    const ids = new Set(parsed.data.order);
    if (ids.size !== parsed.data.order.length || parsed.data.hidden.some((id) => !ids.has(id))) return NextResponse.json({ error: "Home section order must be unique and include hidden sections" }, { status: 400 });
    data.homeSections = JSON.stringify(parsed.data);
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "No supported preferences supplied" }, { status: 400 });

  const preferences = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { theme: true, preferredArea: true, preferredLocationCode: true, homeSections: true },
  });
  const response = NextResponse.json({ preferences });
  if (data.theme) response.cookies.set("live_theme", data.theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}
