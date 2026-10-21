import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageReservations, merchantRole } from "@/lib/permissions";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await merchantRole(id, user.id);
  if (!canManageReservations(role)) return NextResponse.json({ error: "Forbidden — your role cannot view reservation details" }, { status: 403 });
  const reservations = await prisma.reservation.findMany({
    where: { merchantId: id },
    select: {
      id: true, code: true, quantity: true, totalAmount: true, status: true, pickupWindow: true, expiresAt: true,
      product: { select: { id: true, name: true, imageUrl: true } },
      branch: { select: { id: true, name: true, area: true, city: true, state: { select: { name: true } }, lga: { select: { name: true } }, cityArea: { select: { name: true } }, locality: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" }, take: 20,
  });
  return NextResponse.json({ reservations }, { headers: { "Cache-Control": "private, no-store" } });
}
