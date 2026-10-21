import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageTeam, merchantRole } from "@/lib/permissions";

const branchSchema = z.object({
  merchantId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(240),
  stateCode: z.string().trim().min(3).max(64),
  lgaCode: z.string().trim().min(3).max(64),
  cityCode: z.string().trim().max(64).optional().nullable(),
  phone: z.string().trim().max(32).regex(/^[+\d() .-]*$/).optional().nullable(),
}).strict();

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const merchantId = request.nextUrl.searchParams.get("merchantId");
  if (!merchantId) return NextResponse.json({ error: "merchantId required" }, { status: 400 });
  if (!await merchantRole(merchantId, user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const branches = await prisma.branch.findMany({ where: { merchantId }, include: { state: true, lga: true, cityArea: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ branches }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = branchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid branch details" }, { status: 400 });
  const input = parsed.data;
  const role = await merchantRole(input.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Only a merchant owner or manager can add branches" }, { status: 403 });

  const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true, organizationId: true } });
  if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  const [state, lga, city] = await Promise.all([
    prisma.geographicArea.findFirst({ where: { code: input.stateCode, countryCode: "NG", active: true }, select: { code: true, type: true } }),
    prisma.geographicArea.findFirst({ where: { code: input.lgaCode, countryCode: "NG", active: true }, select: { code: true, name: true, type: true, parentCode: true } }),
    input.cityCode ? prisma.geographicArea.findFirst({ where: { code: input.cityCode, countryCode: "NG", active: true }, select: { code: true, name: true, type: true, parentCode: true } }) : Promise.resolve(null),
  ]);
  if (!state || !["STATE", "TERRITORY"].includes(state.type)) return NextResponse.json({ error: "Choose a listed Nigerian state or the FCT territory" }, { status: 400 });
  if (!lga || lga.parentCode !== state.code || !["LGA", "AREA_COUNCIL"].includes(lga.type)) return NextResponse.json({ error: "The selected LGA or area council does not belong to that state or territory" }, { status: 400 });
  if (input.cityCode && (!city || city.type !== "CITY" || city.parentCode !== state.code)) return NextResponse.json({ error: "The selected city does not belong to that state or territory" }, { status: 400 });

  try {
    const branch = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: {
          merchantId: merchant.id,
          organizationId: merchant.organizationId,
          name: input.name,
          address: input.address,
          area: lga.name,
          city: city?.name || "",
          countryCode: "NG",
          stateCode: state.code,
          lgaCode: lga.code,
          cityCode: city?.code || null,
          phone: input.phone || null,
        },
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: "BRANCH_CREATE", resourceType: "Branch", resourceId: created.id } });
      return created;
    });
    return NextResponse.json({ branch }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Branch could not be added. Please try again." }, { status: 400 });
  }
}
