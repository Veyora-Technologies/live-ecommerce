import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageReservations, merchantRole } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: merchantId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await merchantRole(merchantId, user.id);
  if (!canManageReservations(role)) return NextResponse.json({ error: "Forbidden — your role cannot view appointment details" }, { status: 403 });
  const status = req.nextUrl.searchParams.get("status");
  const allowedStatuses = ["REQUESTED", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"];
  if (status && !allowedStatuses.includes(status)) return NextResponse.json({ error: "Unsupported appointment status filter" }, { status: 400 });
  const bookings = await prisma.serviceBooking.findMany({
    where: { merchantId, ...(status ? { status } : {}) },
    select: {
      id: true, serviceId: true, merchantId: true, startTime: true, endTime: true, status: true, priceSnapshot: true, createdAt: true, updatedAt: true,
      service: { select: { id: true, name: true, durationMin: true } },
    },
    orderBy: { startTime: "asc" }, take: 100,
  });
  return NextResponse.json({ bookings }, { headers: { "Cache-Control": "private, no-store" } });
}
