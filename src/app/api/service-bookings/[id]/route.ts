import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageReservations, merchantRole } from "@/lib/permissions";

const actionSchema = z.object({ action: z.enum(["confirm", "reject", "cancel", "complete"]) }).strict();
const nextStatus: Record<string, string> = { confirm: "CONFIRMED", reject: "REJECTED", cancel: "CANCELLED", complete: "COMPLETED" };
const allowed: Record<string, string[]> = {
  REQUESTED: ["confirm", "reject", "cancel"],
  CONFIRMED: ["cancel", "complete"],
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose confirm, reject, cancel, or complete" }, { status: 400 });
  const booking = await prisma.serviceBooking.findUnique({ where: { id }, include: { service: { select: { name: true } }, merchant: { select: { id: true, ownerId: true, businessName: true } } } });
  if (!booking) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const role = await merchantRole(booking.merchantId, user.id);
  const isProvider = canManageReservations(role);
  const isConsumer = booking.consumerId === user.id;
  if (!isProvider && !isConsumer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const action = parsed.data.action;
  if (["confirm", "reject", "complete"].includes(action) && !isProvider) return NextResponse.json({ error: "Only authorized provider staff can change this appointment to that status" }, { status: 403 });
  if (!allowed[booking.status]?.includes(action)) return NextResponse.json({ error: `Cannot ${action} an appointment in ${booking.status} status` }, { status: 409 });

  const status = nextStatus[action];
  const correlationId = req.headers.get("x-request-id") || undefined;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.serviceBooking.updateMany({ where: { id, status: booking.status }, data: { status } });
      if (result.count !== 1) throw new Error("Appointment status changed; refresh and try again");
      const actorIsProvider = isProvider;
      const recipientId = actorIsProvider ? booking.consumerId : booking.merchant.ownerId;
      const title = status === "CONFIRMED" ? "Appointment confirmed" : status === "REJECTED" ? "Appointment declined" : status === "COMPLETED" ? "Appointment marked complete" : "Appointment cancelled";
      const body = `${booking.service.name} at ${booking.merchant.businessName} is now ${status.toLowerCase().replaceAll("_", " ")}`;
      await tx.notification.create({ data: { recipientId, type: `BOOKING_${status}`, title, body, resourceType: "ServiceBooking", resourceId: booking.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: `SERVICE_BOOKING_${status}`, resourceType: "ServiceBooking", resourceId: booking.id, correlationId, outcome: status, previousState: booking.status, newState: status } });
      return tx.serviceBooking.findUnique({ where: { id } });
    });
    return NextResponse.json({ booking: updated }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    const changed = cause instanceof Error && cause.message.includes("status changed");
    return NextResponse.json({ error: changed ? "Appointment status changed; refresh and try again" : "Appointment could not be updated" }, { status: changed ? 409 : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
