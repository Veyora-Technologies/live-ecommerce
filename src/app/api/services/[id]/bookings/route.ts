import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { hasServiceCapacity, validateServiceBookingWindow } from "@/lib/service-bookings";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageReservations, merchantRole } from "@/lib/permissions";
import { sha256 } from "@/lib/security";
import { requirePolicyAcceptances, requirePolicyAcceptancesInTransaction } from "@/lib/legal";
import { publicMarketplaceServiceIds, publicMarketplaceServiceInTransaction } from "@/lib/marketplace";

const bookingSchema = z.object({
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
}).strict();

class BookingConflict extends Error {}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: serviceId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const policyCheck = await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] });
  if (!policyCheck.allowed) return NextResponse.json({ error: policyCheck.message || "Review Live policies before requesting an appointment.", code: policyCheck.code, missingPolicies: policyCheck.missing, policyUrl: "/legal" }, { status: policyCheck.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });
  const parsed = bookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid appointment request" }, { status: 400 });
  const { startTime, endTime } = parsed.data;
  const requestKey = (req.headers.get("idempotency-key") || parsed.data.idempotencyKey || "").trim();
  if (requestKey.length < 8 || requestKey.length > 120) return NextResponse.json({ error: "A unique Idempotency-Key header (8–120 characters) is required" }, { status: 400 });
  const idempotencyKey = sha256(`${user.id}:service-booking:${requestKey}`);

  const publicServiceIds = await publicMarketplaceServiceIds([serviceId]);
  if (!publicServiceIds.has(serviceId)) return NextResponse.json({ error: "Service is not currently available for appointment requests." }, { status: 404 });
  const service = await prisma.service.findUnique({ where: { id: serviceId }, include: { merchant: { select: { id: true, ownerId: true, status: true, businessName: true } } } });
  if (!service || service.merchant.status !== "APPROVED") return NextResponse.json({ error: "Service not found" }, { status: 404 });

  let window: { start: Date; end: Date };
  try { window = validateServiceBookingWindow(startTime, endTime, service.durationMin); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Invalid appointment window" }, { status: 400 }); }

  const requestHash = sha256(`${serviceId}:${window.start.toISOString()}:${window.end.toISOString()}`);
  if (idempotencyKey) {
    const existing = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
    if (existing) {
      if (existing.route !== "service-booking.create" || existing.requestHash !== requestHash || existing.userId !== user.id) return NextResponse.json({ error: "Idempotency key was already used for different appointment details" }, { status: 422 });
      let bookingId = "";
      try { bookingId = JSON.parse(existing.responseBody || "{}").bookingId || ""; } catch {}
      const booking = bookingId ? await prisma.serviceBooking.findUnique({ where: { id: bookingId } }) : null;
      if (booking) return NextResponse.json({ booking, duplicate: true }, { headers: { "Cache-Control": "private, no-store" } });
      return NextResponse.json({ error: "This appointment request is still being processed. Check Activity before retrying." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
  }

  const correlationId = req.headers.get("x-request-id") || randomUUID();
  try {
    const booking = await prisma.$transaction(async (tx) => {
      if (!await publicMarketplaceServiceInTransaction(tx, serviceId)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
      const overlapping = await tx.serviceBooking.findMany({
        where: { serviceId, status: { in: ["REQUESTED", "CONFIRMED"] }, startTime: { lt: window.end }, endTime: { gt: window.start } },
        select: { startTime: true, endTime: true },
      });
      if (!hasServiceCapacity(overlapping, window.start, window.end, service.capacity)) throw new BookingConflict("That appointment time has reached this service's listed capacity. Choose another time.");
      const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: service.merchant.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: service.merchantId });
      if (!sellerPolicy.allowed) throw new Error("LEGAL_POLICY_REQUIRED");
      if (idempotencyKey) await tx.idempotencyRecord.create({ data: { key: idempotencyKey, userId: user.id, route: "service-booking.create", requestHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) } });

      const created = await tx.serviceBooking.create({
        data: {
          serviceId, consumerId: user.id, merchantId: service.merchantId,
          startTime: window.start, endTime: window.end, status: "REQUESTED",
          priceSnapshot: service.price,
        },
      });
      if (idempotencyKey) await tx.idempotencyRecord.update({ where: { key: idempotencyKey }, data: { statusCode: 201, responseBody: JSON.stringify({ bookingId: created.id }) } });
      await tx.notification.create({ data: { recipientId: service.merchant.ownerId, type: "BOOKING_REQUESTED", title: "New appointment request", body: `A customer requested ${service.name}`, resourceType: "ServiceBooking", resourceId: created.id } });
      await tx.notification.create({ data: { recipientId: user.id, type: "BOOKING_REQUESTED", title: "Appointment request sent", body: `Your request for ${service.name} is awaiting provider confirmation`, resourceType: "ServiceBooking", resourceId: created.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "SERVICE_BOOKING_REQUEST", resourceType: "ServiceBooking", resourceId: created.id, correlationId, outcome: "REQUESTED" } });
      return created;
    });
    return NextResponse.json({ booking, note: "Requested; the provider must confirm this appointment." }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause: any) {
    if (cause instanceof Error && cause.message === "MARKETPLACE_LISTING_NOT_PUBLIC") return NextResponse.json({ error: "Service is not currently available for appointment requests." }, { status: 404 });
    if (cause instanceof Error && cause.message === "LEGAL_POLICY_REQUIRED") return NextResponse.json({ error: "The seller has not accepted the current seller agreement. This appointment request was not created." }, { status: 428 });
    if (cause instanceof BookingConflict) return NextResponse.json({ error: cause.message }, { status: 409 });
    if (idempotencyKey && String(cause?.code) === "P2002") {
      const record = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
      if (record && record.route === "service-booking.create" && record.userId === user.id && record.requestHash === requestHash) {
        let bookingId = "";
        try { bookingId = JSON.parse(record.responseBody || "{}").bookingId || ""; } catch {}
        const existing = bookingId ? await prisma.serviceBooking.findUnique({ where: { id: bookingId } }) : null;
        if (existing) return NextResponse.json({ booking: existing, duplicate: true }, { headers: { "Cache-Control": "private, no-store" } });
        return NextResponse.json({ error: "This appointment request is still being processed. Check Activity before retrying." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
      }
      return NextResponse.json({ error: "Idempotency key was already used for different appointment details" }, { status: 422 });
    }
    return NextResponse.json({ error: "Appointment request could not be recorded. Please retry without assuming it was confirmed." }, { status: 409 });
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: serviceId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, merchantId: true } });
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });
  const role = await merchantRole(service.merchantId, user.id);
  const canSeeAll = canManageReservations(role);
  const bookings = await prisma.serviceBooking.findMany({
    where: { serviceId, ...(canSeeAll ? {} : { consumerId: user.id }) },
    select: {
      id: true, serviceId: true, consumerId: true, merchantId: true, startTime: true, endTime: true, status: true, priceSnapshot: true, createdAt: true, updatedAt: true,
      service: { select: { name: true, durationMin: true } },
      ...(canSeeAll ? { consumer: { select: { id: true, name: true } } } : {}),
    },
    orderBy: { startTime: "asc" }, take: 100,
  });
  return NextResponse.json({ bookings }, { headers: { "Cache-Control": "private, no-store" } });
}
