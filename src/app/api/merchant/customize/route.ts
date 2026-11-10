import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canCustomize } from "@/lib/permissions";
import { DEFAULT_MARKET_CODE, isMarketIntegrationReady } from "@/lib/market-config";
import { parseMajorAmountToMinor } from "@/lib/money";
import { isMediaPath } from "@/lib/media-path";

/** https URL, or the same-origin path of an image uploaded through /api/uploads. */
const storefrontImage = (label: string) => z.string().min(1).max(500).refine((value) => {
  if (isMediaPath(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, `${label} must be an https:// URL or an uploaded /api/media/… path`);

/** Storefront customization. Verification/trust fields are NOT editable here. */
const customizeSchema = z.object({
  merchantId: z.string().trim().min(1).max(40),
  description: z.string().max(2000).nullable().optional(),
  // Only https URLs and our own uploaded media are rendered; reject data:/javascript:/http:.
  imageUrl: z.preprocess((value) => value === "" ? null : value, storefrontImage("Image").nullable().optional()),
  coverImageUrl: z.preprocess((value) => value === "" ? null : value, storefrontImage("Cover image").nullable().optional()),
  // Contact details are rendered inside tel:/wa.me links for signed-in users.
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Use a phone number with digits, spaces, +, - or parentheses").optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  whatsapp: z.preprocess((value) => value === "" ? null : value, z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Use a WhatsApp number with digits, spaces, +, - or parentheses").nullable().optional()),
  pickupAvailable: z.boolean().optional(),
  deliveryAvailable: z.boolean().optional(),
  deliveryFee: z.union([z.string().max(30), z.number().finite()]).nullable().optional(),
  featuredProductIds: z.array(z.string().max(40)).max(8).optional(),
  openingHours: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const parsed = customizeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid storefront details" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const body = parsed.data;
  const role = await merchantRole(body.merchantId, user.id);
  if (!canCustomize(role)) return NextResponse.json({ error: "Only owners/managers can customize the storefront" }, { status: 403 });

  const deliverySettingsRequested = body.deliveryAvailable === true || (body.deliveryFee !== undefined && body.deliveryFee !== null);
  if (deliverySettingsRequested && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations")) {
    return NextResponse.json({ error: "Delivery is unavailable because Furnivo has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const data: Record<string, unknown> = {};
  for (const key of ["description", "imageUrl", "coverImageUrl", "phone", "email", "whatsapp", "pickupAvailable", "deliveryAvailable"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.deliveryFee !== undefined) {
    if (body.deliveryFee === null) data.deliveryFee = null;
    else {
      const amountMinor = parseMajorAmountToMinor(String(body.deliveryFee), 2);
      if (amountMinor === null || amountMinor > 2_147_483_647n) {
        return NextResponse.json({ error: "Delivery fee must be an exact nonnegative NGN amount with at most two decimal places." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      data.deliveryFee = Number(amountMinor);
    }
  }
  if (body.featuredProductIds !== undefined) data.featuredProductIds = JSON.stringify(body.featuredProductIds);
  if (body.openingHours !== undefined) data.openingHours = body.openingHours === null ? null : JSON.stringify(body.openingHours);
  if (!Object.keys(data).length) return NextResponse.json({ error: "No storefront changes supplied" }, { status: 400 });

  try {
    const merchant = await prisma.merchant.update({ where: { id: body.merchantId }, data });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "STOREFRONT_UPDATE", resourceType: "Merchant", resourceId: body.merchantId } });
    return NextResponse.json({ merchant, note: "Verification, trust, and unconfigured delivery settings cannot be enabled here." }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Storefront update failed; existing details were not confirmed as changed." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
