import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MERCHANT_MODERATION_ROLES, requireAdminRole } from "@/lib/admin-access";

const actionSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(["approve", "reject", "suspend", "pending"]),
}).strict();

export async function GET() {
  const admin = await requireAdminRole(MERCHANT_MODERATION_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { id: true, name: true } }, products: { select: { id: true } } },
  });
  return NextResponse.json({ merchants }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminRole(MERCHANT_MODERATION_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid merchant action" }, { status: 400 });
  const { id, action } = parsed.data;
  const statusByAction = { approve: "APPROVED", reject: "REJECTED", suspend: "SUSPENDED", pending: "PENDING" } as const;
  const status = statusByAction[action];

  // Platform approval is a moderation decision, not proof of identity or an
  // independent verification. Keep verificationStatus unchanged.
  const [merchant] = await prisma.$transaction([
    prisma.merchant.update({
      where: { id },
      data: { status },
      include: { owner: { select: { id: true, name: true } }, products: { select: { id: true } } },
    }),
    prisma.auditLog.create({
      data: { actorId: admin.user.id, action: `MERCHANT_${action.toUpperCase()}`, resourceType: "Merchant", resourceId: id },
    }),
  ]);
  return NextResponse.json({ merchant }, { headers: { "Cache-Control": "private, no-store" } });
}
