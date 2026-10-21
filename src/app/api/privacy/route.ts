import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getLegalReleaseGate, isLegalProductionMode } from "@/lib/legal";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  type: z.enum(["DELETE", "ACCESS", "RECTIFY", "OBJECT"]),
  detail: z.string().trim().max(500).optional(),
}).strict();
const preferenceSchema = z.object({ marketingConsent: z.boolean() }).strict();

function makeCaseCode() {
  return `PR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  if (action === "export") {
    const [profile, reservations, serviceBookings, savedItems, searches, lists, alerts, enquiries, reviews, recentViews, notificationPreferences, notifications, privacyRequests, cases, merchantMemberships, ownedMerchants] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, email: true, phone: true, preferredArea: true, preferredLocationCode: true, theme: true, homeSections: true, marketingConsent: true, createdAt: true } }),
      prisma.reservation.findMany({ where: { consumerId: user.id }, select: { id: true, code: true, status: true, totalAmount: true, quantity: true, pickupWindow: true, createdAt: true, product: { select: { name: true } }, merchant: { select: { businessName: true } } } }),
      prisma.serviceBooking.findMany({ where: { consumerId: user.id }, select: { id: true, startTime: true, endTime: true, status: true, priceSnapshot: true, createdAt: true, service: { select: { name: true } }, merchant: { select: { businessName: true } } } }),
      prisma.savedItem.findMany({ where: { userId: user.id } }),
      prisma.savedSearch.findMany({ where: { userId: user.id }, select: { query: true, filters: true, label: true, alertEnabled: true, alertFrequency: true, createdAt: true } }),
      prisma.shoppingList.findMany({ where: { ownerId: user.id }, select: { name: true, description: true, createdAt: true, updatedAt: true, items: { select: { customName: true, productId: true, quantity: true, checked: true } } } }),
      prisma.priceAlert.findMany({ where: { userId: user.id } }),
      prisma.enquiry.findMany({ where: { requesterId: user.id }, select: { subject: true, status: true, createdAt: true, messages: { select: { body: true, createdAt: true }, orderBy: { createdAt: "asc" } } } }),
      prisma.review.findMany({ where: { authorId: user.id }, select: { rating: true, text: true, createdAt: true, status: true } }),
      prisma.recentView.findMany({ where: { userId: user.id }, select: { productId: true, viewedAt: true }, orderBy: { viewedAt: "desc" } }),
      prisma.notificationPreference.findUnique({ where: { userId: user.id } }),
      prisma.notification.findMany({ where: { recipientId: user.id }, select: { type: true, title: true, body: true, resourceType: true, resourceId: true, read: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
      prisma.privacyRequest.findMany({ where: { userId: user.id }, select: { type: true, status: true, createdAt: true, updatedAt: true } }),
      prisma.complianceCase.findMany({ where: { reporterId: user.id, caseType: { in: ["COMPLAINT", "DISPUTE", "IP_REPORT"] } }, select: { caseCode: true, caseType: true, status: true, title: true, publicSummary: true, outcome: true, outcomeSummary: true, createdAt: true, events: { where: { visibility: "REPORTER" }, select: { message: true, createdAt: true }, orderBy: { createdAt: "asc" } } } }),
      prisma.merchantMembership.findMany({ where: { userId: user.id }, select: { role: true, status: true, createdAt: true, merchant: { select: { businessName: true } } } }),
      prisma.merchant.findMany({ where: { ownerId: user.id }, select: { businessName: true, category: true, status: true, createdAt: true } }),
    ]);
    await prisma.privacyRequest.create({ data: { userId: user.id, type: "EXPORT", status: "COMPLETED", note: "Self-service export generated" } });
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), profile, reservations, serviceBookings, savedItems, searches, lists, priceAlerts: alerts, enquiries, reviews, recentViews, notificationPreferences, notifications, privacyRequests, complaintCases: cases, merchantMemberships, ownedMerchants }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=live-data-export.json", "Cache-Control": "private, no-store", "Pragma": "no-cache" },
    });
  }
  const [requests, profile, gate] = await Promise.all([
    prisma.privacyRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, createdAt: true, updatedAt: true, complianceCase: { select: { caseCode: true, status: true, publicSummary: true } } },
    }),
    prisma.legalOperatorProfile.findUnique({ where: { id: "primary" }, select: { privacyContactEmail: true } }),
    getLegalReleaseGate("ACCOUNT"),
  ]);
  const releaseNote = isLegalProductionMode()
    ? gate.ready ? "The production account-policy release gate reports complete recorded information. Request intake is still not an automatic completion or legal determination." : "The production privacy and account-policy release gate is incomplete. Authenticated request intake and export remain available, but this status is not a representation of completed legal review."
    : "A non-production policy-gate bypass is active; it does not imply production readiness or external legal review.";
  const contactNote = profile?.privacyContactEmail ? ` Recorded privacy contact: ${profile.privacyContactEmail}.` : " No privacy contact has been recorded.";
  return NextResponse.json({
    requests,
    notice: `${releaseNote}${contactNote} No response-time commitment is published in this workspace.`,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an access, correction, objection, or account-deletion request. Do not include passwords, identity numbers, card details, or other secrets." }, { status: 400 });
  const { type, detail } = parsed.data;
  const caseCode = makeCaseCode();
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.privacyRequest.create({ data: { userId: user.id, type, note: detail || null } });
    const caseRecord = await tx.complianceCase.create({
      data: {
        caseCode,
        caseType: "PRIVACY_REQUEST",
        status: "OPEN",
        priority: type === "DELETE" ? "HIGH" : "NORMAL",
        title: `Data subject request: ${type.toLowerCase()}`,
        reporterSummary: `Authenticated user submitted a ${type.toLowerCase()} request.`,
        reporterId: user.id,
        privacyRequestId: request.id,
      },
      select: { id: true, caseCode: true, status: true },
    });
    await tx.complianceCaseEvent.create({ data: { caseId: caseRecord.id, actorId: user.id, eventType: "CREATED", visibility: "INTERNAL", message: "Authenticated privacy request received." } });
    await tx.auditLog.create({ data: { actorId: user.id, action: `PRIVACY_REQUEST_${type}`, resourceType: "PrivacyRequest", resourceId: request.id, outcome: "OPEN", metadata: JSON.stringify({ caseCode, type }) } });
    return { request, caseRecord };
  });
  return NextResponse.json({
    request: { id: result.request.id, type: result.request.type, status: result.request.status, createdAt: result.request.createdAt, caseCode: result.caseRecord.caseCode },
    notice: "Your request has been recorded. Status can be checked in the privacy portal. We do not publish a response-time commitment in this workspace.",
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = preferenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a boolean marketingConsent value." }, { status: 400 });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { marketingConsent: parsed.data.marketingConsent }, select: { id: true, marketingConsent: true } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: parsed.data.marketingConsent ? "MARKETING_CONSENT_GRANTED" : "MARKETING_CONSENT_WITHDRAWN", resourceType: "UserPreference", resourceId: user.id, outcome: parsed.data.marketingConsent ? "GRANTED" : "WITHDRAWN" } });
  return NextResponse.json({ preferences: updated, note: "Marketing consent is stored separately from policy acceptance. Channel-level preferences live in /api/notifications/preferences." }, { headers: { "Cache-Control": "private, no-store" } });
}
