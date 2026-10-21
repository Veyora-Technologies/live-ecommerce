import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, revokeAllSessions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function adminOk() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return null;
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  return full && ["SUPER", "SECURITY"].includes(full.adminRole || "") ? user : null;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve-delete"), id: z.string().trim().min(1).max(64) }).strict(),
  z.object({ action: z.literal("complete-delete"), id: z.string().trim().min(1).max(64) }).strict(),
  z.object({ action: z.literal("complete"), id: z.string().trim().min(1).max(64), outcome: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("reject"), id: z.string().trim().min(1).max(64), reason: z.string().trim().min(10).max(500) }).strict(),
]);

export async function GET() {
  const user = await adminOk();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const requests = await prisma.privacyRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, type: true, status: true, createdAt: true, updatedAt: true, approvedAt: true,
      complianceCase: { select: { id: true, caseCode: true, status: true, assignedTo: { select: { name: true } }, dueAt: true, nextReviewAt: true } },
    },
  });
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const user = await adminOk();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid privacy-request action." }, { status: 400 });
  const input = parsed.data;
  const request = await prisma.privacyRequest.findUnique({ where: { id: input.id }, include: { complianceCase: { select: { id: true, status: true } } } });
  if (!request) return NextResponse.json({ error: "Privacy request not found." }, { status: 404 });
  if (request.userId === user.id) return NextResponse.json({ error: "An administrator cannot process their own privacy request." }, { status: 403 });

  if (input.action === "approve-delete") {
    if (request.type !== "DELETE" || request.status !== "PENDING") return NextResponse.json({ error: "Only a pending deletion request can be approved." }, { status: 409 });
    const updated = await prisma.privacyRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
    if (updated.count !== 1) return NextResponse.json({ error: "Another administrator changed this request first." }, { status: 409 });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "PRIVACY_DELETE_APPROVED", resourceType: "PrivacyRequest", resourceId: request.id, outcome: "APPROVED", metadata: JSON.stringify({ secondOperatorRequired: true }) } });
    if (request.complianceCase) await prisma.complianceCaseEvent.create({ data: { caseId: request.complianceCase.id, actorId: user.id, eventType: "INTERNAL_NOTE", visibility: "INTERNAL", message: "Deletion request approved; a different authorized administrator must complete it." } });
    return NextResponse.json({ ok: true, status: "APPROVED", note: "Approval recorded. A different authorized administrator must complete the request after checking for active reservations and appointments." }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "complete-delete") {
    if (request.type !== "DELETE" || request.status !== "APPROVED") return NextResponse.json({ error: "Deletion must be approved by one administrator before a different administrator completes it." }, { status: 409 });
    if (request.approvedById === user.id) return NextResponse.json({ error: "The approving administrator cannot also complete this deletion." }, { status: 403 });
    const [activeReservations, activeAppointments, target] = await Promise.all([
      prisma.reservation.count({ where: { consumerId: request.userId, status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } } }),
      prisma.serviceBooking.count({ where: { consumerId: request.userId, status: { in: ["REQUESTED", "CONFIRMED"] } } }),
      prisma.user.findUnique({ where: { id: request.userId }, select: { id: true, status: true } }),
    ]);
    if (!target) return NextResponse.json({ error: "The account no longer exists." }, { status: 404 });
    if (activeReservations + activeAppointments > 0) return NextResponse.json({ error: "Resolve or close active reservations and appointment requests before account deletion. No account data was changed." }, { status: 409 });

    await revokeAllSessions(request.userId, "account-deleted");
    await prisma.$transaction(async (tx) => {
      await tx.savedItem.deleteMany({ where: { userId: request.userId } });
      await tx.recentView.deleteMany({ where: { userId: request.userId } });
      await tx.savedSearch.deleteMany({ where: { userId: request.userId } });
      await tx.priceAlert.deleteMany({ where: { userId: request.userId } });
      await tx.notification.deleteMany({ where: { recipientId: request.userId } });
      await tx.notificationPreference.deleteMany({ where: { userId: request.userId } });
      await tx.address.deleteMany({ where: { userId: request.userId } });
      await tx.shoppingList.deleteMany({ where: { ownerId: request.userId } });
      await tx.shoppingListMember.deleteMany({ where: { userId: request.userId } });
      await tx.merchantMembership.deleteMany({ where: { userId: request.userId } });
      await tx.orgMembership.deleteMany({ where: { userId: request.userId } });
      await tx.enquiryMessage.deleteMany({ where: { authorId: request.userId } });
      await tx.enquiry.deleteMany({ where: { requesterId: request.userId } });
      await tx.itemRequest.deleteMany({ where: { requesterId: request.userId } });
      await tx.review.deleteMany({ where: { authorId: request.userId } });
      await tx.apiCredential.updateMany({ where: { userId: request.userId }, data: { revoked: true, userId: null } });
      await tx.merchant.updateMany({ where: { ownerId: request.userId }, data: { status: "SUSPENDED", storeStatus: "CLOSED" } });
      await tx.complianceCase.updateMany({
        where: { reporterId: request.userId, caseType: { in: ["COMPLAINT", "DISPUTE", "IP_REPORT", "PRIVACY_COMPLAINT"] } },
        data: { reporterId: null, reporterSummary: "Reporter-submitted content removed during account deletion processing.", publicSummary: null },
      });
      await tx.complianceCaseEvent.updateMany({ where: { actorId: request.userId, visibility: "REPORTER" }, data: { message: "Reporter update removed during account deletion processing." } });
      await tx.user.update({
        where: { id: request.userId },
        data: { name: "Deleted user", email: `deleted-${request.userId}@invalid.local`, phone: null, passwordHash: null, preferredArea: null, preferredLocationCode: null, homeSections: null, theme: "system", marketingConsent: false, deletedAt: new Date(), status: "SUSPENDED", mfaSecret: null, mfaEnabled: false },
      });
      await tx.privacyRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", note: "Identity anonymised and personal collections removed. Some reservation, policy-acceptance, security, and audit records remain; their retention basis and periods require owner/legal review." } });
      if (request.complianceCase) {
        await tx.complianceCase.update({ where: { id: request.complianceCase.id }, data: { status: "RESOLVED", outcome: "ACTIONED", outcomeSummary: "Account anonymised after independent approval; active reservations were absent.", resolvedAt: new Date(), closedAt: null } });
        await tx.complianceCaseEvent.create({ data: { caseId: request.complianceCase.id, actorId: user.id, eventType: "STATUS_CHANGED", fromStatus: request.complianceCase.status, toStatus: "RESOLVED", visibility: "INTERNAL", message: "Deletion completed after separate approval and active-transaction check." } });
      }
      await tx.auditLog.create({ data: { actorId: user.id, action: "PRIVACY_DELETE_COMPLETED", resourceType: "User", resourceId: request.userId, outcome: "COMPLETED", metadata: "identity anonymised; some reservation, policy-acceptance, security and audit records retained; retention review remains open" } });
    });
    return NextResponse.json({ ok: true, note: "The account was anonymised, sessions revoked, and personal collections removed. Some reservation, policy-acceptance, security, and audit records remain; the retention basis and period are not represented as legally reviewed." }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "complete") {
    if (["DELETE", "EXPORT"].includes(request.type) || !["PENDING", "APPROVED"].includes(request.status)) return NextResponse.json({ error: "This request type or status cannot be completed with this action." }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      await tx.privacyRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", note: input.outcome } });
      if (request.complianceCase) {
        await tx.complianceCase.update({ where: { id: request.complianceCase.id }, data: { status: "RESOLVED", outcome: "ACTIONED", outcomeSummary: input.outcome, resolvedAt: new Date() } });
        await tx.complianceCaseEvent.create({ data: { caseId: request.complianceCase.id, actorId: user.id, eventType: "STATUS_CHANGED", fromStatus: request.complianceCase.status, toStatus: "RESOLVED", visibility: "INTERNAL", message: "Privacy request completion was recorded." } });
      }
      await tx.auditLog.create({ data: { actorId: user.id, action: `PRIVACY_REQUEST_${request.type}_COMPLETED`, resourceType: "PrivacyRequest", resourceId: request.id, outcome: "COMPLETED", metadata: JSON.stringify({ outcomeRecorded: true }) } });
    });
    return NextResponse.json({ ok: true, status: "COMPLETED" }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "reject") {
    if (!(["PENDING", "APPROVED"] as string[]).includes(request.status)) return NextResponse.json({ error: "Only an open privacy request can be rejected." }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      await tx.privacyRequest.update({ where: { id: request.id }, data: { status: "REJECTED", note: `Decision recorded: ${input.reason}` } });
      if (request.complianceCase) {
        await tx.complianceCase.update({ where: { id: request.complianceCase.id }, data: { status: "REJECTED", outcome: "OTHER", outcomeSummary: input.reason, resolvedAt: new Date() } });
        await tx.complianceCaseEvent.create({ data: { caseId: request.complianceCase.id, actorId: user.id, eventType: "STATUS_CHANGED", fromStatus: request.complianceCase.status, toStatus: "REJECTED", visibility: "INTERNAL", message: "Privacy request decision was recorded." } });
      }
      await tx.auditLog.create({ data: { actorId: user.id, action: `PRIVACY_REQUEST_${request.type}_REJECTED`, resourceType: "PrivacyRequest", resourceId: request.id, outcome: "REJECTED", metadata: JSON.stringify({ reasonRecorded: true }) } });
    });
    return NextResponse.json({ ok: true, status: "REJECTED" }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({ error: "Unknown privacy request action." }, { status: 400 });
}
