import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_MARKET_CODE, isMarketIntegrationReady } from "@/lib/market-config";

const createMerchantSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  category: z.enum(["PHARMACY", "SUPERMARKET", "PROVISIONS", "CHEMIST"]),
  description: z.string().trim().max(1000).optional().nullable(),
  address: z.string().trim().min(2).max(240),
  phone: z.string().trim().min(7).max(32).regex(/^[+\d() .-]+$/, "Use a valid business phone number"),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  stateCode: z.string().trim().min(3).max(64),
  lgaCode: z.string().trim().min(3).max(64),
  cityCode: z.string().trim().max(64).optional().nullable(),
  pickupAvailable: z.boolean().optional(),
  deliveryAvailable: z.boolean().optional(),
}).strict();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await prisma.merchantMembership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { merchant: true } });
  const owned = await prisma.merchant.findMany({ where: { ownerId: user.id } });
  const all = [...memberships.map((membership) => membership.merchant), ...owned];
  const unique = Array.from(new Map(all.map((merchant) => [merchant.id, merchant])).values());
  return NextResponse.json({ merchants: unique }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = createMerchantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid merchant details" }, { status: 400 });
  const input = parsed.data;
  if (input.deliveryAvailable === true && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations")) {
    return NextResponse.json({ error: "Delivery is unavailable because Furnivo has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const normalizedCityCode = input.cityCode || null;

  const [state, lga, city] = await Promise.all([
    prisma.geographicArea.findFirst({ where: { code: input.stateCode, countryCode: "NG", active: true }, select: { code: true, name: true, type: true } }),
    prisma.geographicArea.findFirst({ where: { code: input.lgaCode, countryCode: "NG", active: true }, select: { code: true, name: true, type: true, parentCode: true } }),
    normalizedCityCode ? prisma.geographicArea.findFirst({ where: { code: normalizedCityCode, countryCode: "NG", active: true }, select: { code: true, name: true, type: true, parentCode: true } }) : Promise.resolve(null),
  ]);
  if (!state || !["STATE", "TERRITORY"].includes(state.type)) return NextResponse.json({ error: "Choose a listed Nigerian state or the FCT territory" }, { status: 400 });
  if (!lga || lga.parentCode !== state.code || !["LGA", "AREA_COUNCIL"].includes(lga.type)) return NextResponse.json({ error: "The selected LGA or area council does not belong to that state or territory" }, { status: 400 });
  if (normalizedCityCode && (!city || city.type !== "CITY" || city.parentCode !== state.code)) return NextResponse.json({ error: "The selected city does not belong to that state or territory" }, { status: 400 });

  try {
    const merchant = await prisma.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: {
          ownerId: user.id,
          businessName: input.businessName,
          category: input.category,
          description: input.description || null,
          address: input.address,
          area: lga.name, // legacy display fallback, sourced from the validated LGA/council
          city: city?.name || "",
          countryCode: "NG",
          stateCode: state.code,
          lgaCode: lga.code,
          cityCode: city?.code || null,
          phone: input.phone,
          email: input.email || null,
          pickupAvailable: input.pickupAvailable ?? false,
          deliveryAvailable: input.deliveryAvailable ?? false,
          status: "PENDING",
          verificationStatus: "PENDING",
        },
      });
      await tx.merchantMembership.create({ data: { merchantId: created.id, userId: user.id, role: "OWNER", status: "ACTIVE" } });
      await tx.branch.create({
        data: {
          merchantId: created.id,
          name: "Main store",
          address: input.address,
          area: lga.name,
          city: city?.name || "",
          countryCode: "NG",
          stateCode: state.code,
          lgaCode: lga.code,
          cityCode: city?.code || null,
          phone: input.phone,
        },
      });
      if (user.role === "CONSUMER") await tx.user.update({ where: { id: user.id }, data: { role: "MERCHANT" } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "MERCHANT_CREATE", resourceType: "Merchant", resourceId: created.id } });
      return created;
    });
    return NextResponse.json({ merchant }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A merchant profile already exists with one of these unique details" }, { status: 409 });
    return NextResponse.json({ error: "Store could not be created. Please try again or contact Furnivo support." }, { status: 400 });
  }
}
