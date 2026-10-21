import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { releaseInventoryUnits } from "@/lib/reservation-stock";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  let body: any = {};
  try { body = await req.json(); } catch {}
  const dryRun = body?.dryRun === true;
  const secret = req.headers.get("x-cron-secret");
  if (!expected && process.env.NODE_ENV === "production") return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (expected) {
    if (secret !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (!dryRun) {
    const user = await getCurrentUser().catch(() => null);
    if (!user?.isAdmin) return NextResponse.json({ error: "Admin authentication is required when CRON_SECRET is unset" }, { status: 403 });
  }

  const now = new Date();
  const staleReservations = await prisma.reservation.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    take: 200,
    select: { id: true, consumerId: true, productId: true, variantId: true, quantity: true, code: true },
  });
  let expired = 0;
  let released = 0;
  let failedReleases = 0;

  if (!dryRun) {
    for (const reservation of staleReservations) {
      try {
        const outcome = await prisma.$transaction(async (tx) => {
          const changed = await tx.reservation.updateMany({
            where: { id: reservation.id, status: "PENDING", expiresAt: { lt: now } },
            data: { status: "EXPIRED" },
          });
          if (changed.count !== 1) return { expired: false, released: 0 };

          await releaseInventoryUnits(tx, reservation.productId, reservation.variantId, reservation.quantity);
          await tx.notification.create({
            data: {
              recipientId: reservation.consumerId,
              type: "RESERVATION_EXPIRED",
              title: "Reservation expired",
              body: `Your reservation ${reservation.code} expired and its reserved stock was released.`,
              resourceType: "Reservation",
              resourceId: reservation.id,
            },
          });
          await tx.auditLog.create({
            data: {
              action: "RESERVATION_EXPIRE",
              resourceType: "Reservation",
              resourceId: reservation.id,
              outcome: "EXPIRED",
              metadata: JSON.stringify({ productId: reservation.productId, variantId: reservation.variantId, quantity: reservation.quantity }),
            },
          });
          return { expired: true, released: reservation.quantity };
        });
        if (outcome.expired) expired += 1;
        released += outcome.released;
      } catch {
        // Leave the reservation pending and its counters untouched so an
        // operator can investigate the inventory mismatch and retry safely.
        failedReleases += 1;
      }
    }
  }

  const staleRequests = await prisma.itemRequest.count({ where: { status: "OPEN", neededBy: { lt: now } } });
  if (!dryRun && staleRequests > 0) await prisma.itemRequest.updateMany({ where: { status: "OPEN", neededBy: { lt: now } }, data: { status: "EXPIRED" } });
  if (!dryRun) {
    await prisma.backgroundJob.create({
      data: {
        type: "RESERVATION_EXPIRY",
        payload: JSON.stringify({ expired, failedReleases, dryRun: false, at: now.toISOString() }),
        status: failedReleases > 0 ? "PARTIAL" : "SUCCESS",
      },
    });
  }

  return NextResponse.json({
    dryRun,
    candidateReservations: staleReservations.length,
    expiredReservations: expired,
    failedReservationReleases: failedReleases,
    stockUnitsReleased: dryRun ? 0 : released,
    expiredItemRequests: staleRequests,
    at: now.toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST for authenticated expiry processing" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
