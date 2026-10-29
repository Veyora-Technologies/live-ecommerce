import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canManageReservations } from "@/lib/permissions";
import { consumeInventoryUnits, InventoryConflictError, releaseInventoryUnits } from "@/lib/reservation-stock";
import { reservationViewSelect } from "@/lib/reservation-view";

const actionSchema = z.object({
  action: z.enum(["confirm", "reject", "ready", "collect", "cancel"]),
  reason: z.string().trim().max(400).optional(),
}).strict();
const transitions: Record<string, Partial<Record<z.infer<typeof actionSchema>["action"], string>>> = {
  PENDING: { confirm: "CONFIRMED", reject: "REJECTED", cancel: "CANCELLED" },
  CONFIRMED: { ready: "READY_FOR_PICKUP", cancel: "CANCELLED" },
  READY_FOR_PICKUP: { collect: "COLLECTED", cancel: "CANCELLED" },
};
const notificationTitles: Record<string, string> = {
  CONFIRMED: "Reservation confirmed",
  REJECTED: "Reservation rejected",
  READY_FOR_PICKUP: "Ready for pickup",
  COLLECTED: "Collected • Thank you",
  CANCELLED: "Reservation cancelled",
};
const noStore = { headers: { "Cache-Control": "private, no-store" } };

class ReservationTransitionConflictError extends Error {}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const reservation = await prisma.reservation.findUnique({ where: { id }, select: { ...reservationViewSelect, consumerId: true } });
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404, ...noStore });
  const callerRole = await merchantRole(reservation.merchantId, user.id);
  if (reservation.consumerId !== user.id && !canManageReservations(callerRole) && !user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  }
  const { consumerId, ...reservationData } = reservation;
  const safeReservation = consumerId === user.id
    ? { ...reservationData, consumer: { id: user.id, name: user.name } }
    : reservationData;
  return NextResponse.json({ reservation: safeReservation }, noStore);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid reservation action" }, { status: 400, ...noStore });

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, consumerId: true, merchantId: true, productId: true, variantId: true, quantity: true, status: true, code: true, updatedAt: true, merchant: { select: { ownerId: true } } },
  });
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404, ...noStore });

  const isConsumer = reservation.consumerId === user.id;
  const role = await merchantRole(reservation.merchantId, user.id);
  const isMerchant = canManageReservations(role);
  const { action, reason } = parsed.data;
  if (["confirm", "reject", "ready", "collect"].includes(action) && !isMerchant) {
    return NextResponse.json({ error: "Only an authorized merchant team member can do this" }, { status: 403, ...noStore });
  }
  if (action === "cancel" && !isConsumer && !isMerchant) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });

  const nextStatus = transitions[reservation.status]?.[action];
  if (!nextStatus) return NextResponse.json({ error: `Cannot ${action} from ${reservation.status}` }, { status: 400, ...noStore });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.reservation.updateMany({
        where: { id: reservation.id, status: reservation.status, updatedAt: reservation.updatedAt },
        data: { status: nextStatus },
      });
      if (claimed.count !== 1) throw new ReservationTransitionConflictError("Reservation changed while this action was being processed.");

      if (nextStatus === "REJECTED" || nextStatus === "CANCELLED") {
        await releaseInventoryUnits(tx, reservation.productId, reservation.variantId, reservation.quantity);
      } else if (nextStatus === "COLLECTED") {
        const inventory = await consumeInventoryUnits(tx, reservation.productId, reservation.variantId, reservation.quantity);
        await tx.availabilityEvent.create({
          data: {
            merchantId: reservation.merchantId,
            productId: reservation.productId,
            previousQuantity: inventory.previousStock,
            newQuantity: inventory.nextStock,
            previousStatus: inventory.previousAvailability,
            newStatus: inventory.nextAvailability,
            changeSource: "RESERVATION_COLLECTED",
            actorId: user.id,
          },
        });
      }

      const targetId = isMerchant ? reservation.consumerId : reservation.merchant.ownerId;
      await tx.notification.create({
        data: {
          recipientId: targetId,
          type: nextStatus,
          title: notificationTitles[nextStatus] || nextStatus,
          body: `${action} • ${reservation.code}${reason ? ` • ${reason}` : ""}`,
          resourceType: "Reservation",
          resourceId: reservation.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: `RESERVATION_${action.toUpperCase()}`,
          resourceType: "Reservation",
          resourceId: reservation.id,
          outcome: nextStatus,
          metadata: reason ? JSON.stringify({ reason }) : null,
        },
      });

      return tx.reservation.findUnique({ where: { id: reservation.id } });
    });
    if (!updated) throw new Error("Reservation update was not found after commit.");
    // Destructured purely to omit `consumerId` from the response body. The binding is
    // intentionally unused: deleting it instead of renaming would leak the field.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { consumerId: _consumerId, ...safeReservation } = updated;
    return NextResponse.json({ reservation: safeReservation }, noStore);
  } catch (error) {
    if (error instanceof ReservationTransitionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409, ...noStore });
    }
    if (error instanceof InventoryConflictError) {
      return NextResponse.json({ error: error.message, code: "INVENTORY_REVIEW_REQUIRED" }, { status: 409, ...noStore });
    }
    return NextResponse.json({ error: "Reservation could not be updated; no inventory change was committed." }, { status: 500, ...noStore });
  }
}
