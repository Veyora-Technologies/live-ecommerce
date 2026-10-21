import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  type: z.enum(["COMPLAINT", "DISPUTE", "IP_REPORT"]),
  subject: z.string().trim().min(4).max(160),
  details: z.string().trim().min(10).max(4000),
  listingId: z.string().trim().min(1).max(64).optional(),
  reservationId: z.string().trim().min(1).max(64).optional(),
  serviceBookingId: z.string().trim().min(1).max(64).optional(),
  merchantId: z.string().trim().min(1).max(64).optional(),
}).strict().superRefine((value, context) => {
  if (value.type === "IP_REPORT" && !value.listingId) context.addIssue({ code: "custom", message: "Select the listing associated with the intellectual-property concern." });
  if (value.type === "DISPUTE" && !value.reservationId && !value.serviceBookingId) context.addIssue({ code: "custom", message: "Choose the reservation or appointment related to the dispute." });
  if (value.reservationId && value.serviceBookingId) context.addIssue({ code: "custom", message: "Choose one reservation or appointment." });
});

function makeCaseCode() {
  return `LV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [cases, reservations, serviceBookings] = await Promise.all([
    prisma.complianceCase.findMany({
      where: { reporterId: user.id, caseType: { in: ["COMPLAINT", "DISPUTE", "IP_REPORT"] } },
      select: {
        id: true,
        caseCode: true,
        caseType: true,
        status: true,
        priority: true,
        title: true,
        publicSummary: true,
        outcome: true,
        outcomeSummary: true,
        createdAt: true,
        updatedAt: true,
        events: { where: { visibility: "REPORTER" }, select: { eventType: true, message: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 30 },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.reservation.findMany({
      where: { consumerId: user.id },
      select: { id: true, code: true, status: true, createdAt: true, product: { select: { name: true } }, merchant: { select: { businessName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.serviceBooking.findMany({
      where: { consumerId: user.id },
      select: { id: true, status: true, startTime: true, createdAt: true, service: { select: { name: true } }, merchant: { select: { businessName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return NextResponse.json({ cases, references: { reservations, serviceBookings } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Provide a valid complaint." }, { status: 400 });
  const input = parsed.data;

  let merchantId = input.merchantId ?? null;
  if (input.listingId) {
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: input.listingId }, select: { id: true, merchantId: true } });
    if (!listing) return NextResponse.json({ error: "The reported listing was not found." }, { status: 404 });
    if (merchantId && listing.merchantId !== merchantId) return NextResponse.json({ error: "The listing and business references do not match." }, { status: 400 });
    merchantId = listing.merchantId;
  }
  if (input.reservationId) {
    const reservation = await prisma.reservation.findFirst({ where: { id: input.reservationId, consumerId: user.id }, select: { id: true, merchantId: true } });
    if (!reservation) return NextResponse.json({ error: "The reservation was not found for this account." }, { status: 404 });
    if (merchantId && merchantId !== reservation.merchantId) return NextResponse.json({ error: "The reservation and business references do not match." }, { status: 400 });
    merchantId = reservation.merchantId;
  }
  if (input.serviceBookingId) {
    const booking = await prisma.serviceBooking.findFirst({ where: { id: input.serviceBookingId, consumerId: user.id }, select: { id: true, merchantId: true } });
    if (!booking) return NextResponse.json({ error: "The appointment was not found for this account." }, { status: 404 });
    if (merchantId && merchantId !== booking.merchantId) return NextResponse.json({ error: "The appointment and business references do not match." }, { status: 400 });
    merchantId = booking.merchantId;
  }
  if (input.merchantId && !merchantId) {
    const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true } });
    if (!merchant) return NextResponse.json({ error: "The business was not found." }, { status: 404 });
    merchantId = merchant.id;
  }

  const caseType = input.type;
  const caseCode = makeCaseCode();
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.complianceCase.create({
      data: {
        caseCode,
        caseType,
        status: "OPEN",
        priority: caseType === "IP_REPORT" ? "HIGH" : "NORMAL",
        title: input.subject,
        reporterSummary: input.details,
        reporterId: user.id,
        merchantId,
        listingId: input.listingId ?? null,
        reservationId: input.reservationId ?? null,
        serviceBookingId: input.serviceBookingId ?? null,
      },
      select: { id: true, caseCode: true, caseType: true, status: true, createdAt: true },
    });
    await tx.complianceCaseEvent.create({ data: { caseId: record.id, actorId: user.id, eventType: "CREATED", visibility: "INTERNAL", message: "Reporter submitted a case." } });
    await tx.auditLog.create({ data: { actorId: user.id, action: `COMPLIANCE_${caseType}_SUBMITTED`, resourceType: "ComplianceCase", resourceId: record.id, outcome: "OPEN", metadata: JSON.stringify({ caseCode, caseType }) } });
    return record;
  });

  return NextResponse.json({ case: created, notice: "Your report has been recorded for review. This is an intake receipt, not a finding, decision, response-time commitment, refund decision, or promise of removal. Check this page for status updates." }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
