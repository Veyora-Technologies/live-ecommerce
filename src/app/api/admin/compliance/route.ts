import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { CASE_PRIORITIES, CASE_STATUSES, COMPLIANCE_CASE_TYPES, TASK_STATUSES, caseTypeManageableByRole, caseTypeVisibleToRole, canTransitionCase, isOpaqueEvidenceReference } from "@/lib/compliance-access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function adminContext() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return null;
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  const role = full?.adminRole || "NONE";
  return ["SUPER", "SECURITY", "REVIEWER", "SUPPORT"].includes(role) ? { user, role } : null;
}

function visibleTypes(role: string) {
  if (role === "SUPER") return [...COMPLIANCE_CASE_TYPES];
  if (role === "SECURITY") return ["PRIVACY_REQUEST", "PRIVACY_COMPLAINT", "INCIDENT", "VERIFICATION"];
  if (role === "REVIEWER") return ["COMPLAINT", "DISPUTE", "IP_REPORT", "MODERATION", "VERIFICATION"];
  if (role === "SUPPORT") return ["COMPLAINT", "DISPUTE"];
  return [];
}

const isoDate = z.string().datetime({ offset: true }).nullable().optional();
const caseCreateSchema = z.object({
  caseType: z.enum(COMPLIANCE_CASE_TYPES),
  title: z.string().trim().min(4).max(160),
  reporterSummary: z.string().trim().min(10).max(4000),
  priority: z.enum(CASE_PRIORITIES).optional(),
  merchantId: z.string().trim().min(1).max(64).optional(),
  listingId: z.string().trim().min(1).max(64).optional(),
  reservationId: z.string().trim().min(1).max(64).optional(),
  serviceBookingId: z.string().trim().min(1).max(64).optional(),
  verificationCaseId: z.string().trim().min(1).max(64).optional(),
  awarenessAt: z.string().datetime({ offset: true }).optional(),
  incidentKind: z.enum(["PERSONAL_DATA_BREACH", "CYBER_SECURITY", "SAFETY", "MARKETPLACE_ABUSE", "OTHER"]).optional(),
  nextReviewAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.caseType === "INCIDENT" && (!value.awarenessAt || !value.incidentKind)) context.addIssue({ code: "custom", message: "Incident cases require an awareness time and incident type." });
  if (value.caseType === "VERIFICATION" && !value.verificationCaseId && !value.merchantId) context.addIssue({ code: "custom", message: "Select a verification case or merchant." });
  if (value.reservationId && value.serviceBookingId) context.addIssue({ code: "custom", message: "Link one reservation or service appointment, not both." });
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), caseId: z.string().trim().min(1).max(64), assigneeId: z.string().trim().min(1).max(64).nullable() }).strict(),
  z.object({
    action: z.literal("transition"),
    caseId: z.string().trim().min(1).max(64),
    status: z.enum(CASE_STATUSES),
    priority: z.enum(CASE_PRIORITIES).optional(),
    dueAt: isoDate,
    nextReviewAt: isoDate,
    outcome: z.enum(["ACTIONED", "NO_BREACH_FOUND", "REFERRED", "WITHDRAWN", "DUPLICATE", "OUT_OF_SCOPE", "OTHER"]).optional(),
    outcomeSummary: z.string().trim().min(5).max(1200).optional(),
    publicSummary: z.string().trim().min(5).max(1200).optional(),
    internalNote: z.string().trim().min(5).max(2000).optional(),
    riskAssessment: z.enum(["UNKNOWN", "NO_IDENTIFIED_RISK", "RISK", "HIGH_RISK", "NOT_APPLICABLE"]).optional(),
    containmentSummary: z.string().trim().min(5).max(1200).optional(),
    ndpcNotifiedAt: isoDate,
    dataSubjectsNotifiedAt: isoDate,
    externalReportReference: z.string().trim().min(3).max(128).nullable().optional(),
  }).strict(),
  z.object({ action: z.literal("add-task"), caseId: z.string().trim().min(1).max(64), title: z.string().trim().min(4).max(160), assigneeId: z.string().trim().min(1).max(64).nullable().optional(), dueAt: isoDate, nextReviewAt: isoDate }).strict(),
  z.object({ action: z.literal("update-task"), taskId: z.string().trim().min(1).max(64), status: z.enum(TASK_STATUSES), outcome: z.string().trim().min(5).max(1000).optional(), dueAt: isoDate, nextReviewAt: isoDate }).strict(),
  z.object({ action: z.literal("add-evidence-reference"), caseId: z.string().trim().min(1).max(64), evidenceType: z.string().trim().min(3).max(80), referenceCode: z.string().trim().min(3).max(128), summary: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("verification-update"), verificationCaseId: z.string().trim().min(1).max(64), stage: z.enum(["SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "REJECTED", "SUSPENDED", "DUE_REVERIFICATION", "APPROVED"]), outcomeNote: z.string().trim().min(5).max(1200), nextReviewAt: isoDate }).strict(),
]);

function makeCaseCode() {
  return `OP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET(request: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const caseId = request.nextUrl.searchParams.get("id")?.trim();
  if (caseId) {
    const record = await prisma.complianceCase.findUnique({
      where: { id: caseId },
      include: {
        assignedTo: { select: { id: true, name: true } },
        merchant: { select: { id: true, businessName: true, status: true } },
        listing: { select: { id: true, title: true, lifecycleStatus: true, moderationStatus: true } },
        reservation: { select: { id: true, code: true, status: true } },
        serviceBooking: { select: { id: true, status: true, startTime: true, endTime: true, service: { select: { name: true } } } },
        verificationCase: { select: { id: true, stage: true, evidenceType: true, evidenceRef: true, outcomeNote: true, nextReviewAt: true } },
        events: { where: ctx.role === "SUPPORT" ? { eventType: { not: "INTERNAL_NOTE" } } : {}, orderBy: { createdAt: "asc" }, take: 100, include: { actor: { select: { id: true, name: true } } } },
        tasks: { orderBy: { createdAt: "desc" }, take: 100, include: { assignee: { select: { id: true, name: true, adminRole: true } } } },
        evidence: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!record || !caseTypeVisibleToRole(ctx.role, record.caseType, record.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Case not found or access is not permitted." }, { status: 404 });
    const { evidence, ...safeRecord } = record;
    return NextResponse.json({
      case: {
        ...safeRecord,
        internalSummary: ctx.role === "SUPPORT" ? null : safeRecord.internalSummary,
        verificationCase: safeRecord.verificationCase ? { ...safeRecord.verificationCase, evidenceRef: ctx.role === "SUPER" || ctx.role === "SECURITY" ? safeRecord.verificationCase.evidenceRef : null } : null,
        evidence: ctx.role === "SUPER" || ctx.role === "SECURITY" ? evidence : [],
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const typeFilter = visibleTypes(ctx.role);
  const cases = await prisma.complianceCase.findMany({
    where: { caseType: { in: typeFilter }, ...(ctx.role === "SUPPORT" ? { assignedToId: ctx.user.id } : {}) },
    select: {
      id: true, caseCode: true, caseType: true, status: true, priority: true, title: true,
      assignedTo: { select: { id: true, name: true } },
      merchant: { select: { id: true, businessName: true } },
      dueAt: true, nextReviewAt: true, createdAt: true, updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  const [verificationCases, moderationQueueCount, assignees] = await Promise.all([
    ["SUPER", "SECURITY", "REVIEWER"].includes(ctx.role)
      ? prisma.verificationCase.findMany({
          orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }], take: 100,
          select: { id: true, merchantId: true, stage: true, evidenceType: true, outcomeNote: true, nextReviewAt: true, createdAt: true, updatedAt: true, merchant: { select: { businessName: true, status: true } } },
        })
      : Promise.resolve([]),
    ["SUPER", "REVIEWER"].includes(ctx.role)
      ? prisma.marketplaceListing.count({ where: { lifecycleStatus: "PENDING_REVIEW", moderationStatus: "PENDING" } })
      : Promise.resolve(null),
    ctx.role !== "SUPPORT"
      ? prisma.user.findMany({ where: { isAdmin: true, status: "ACTIVE", deletedAt: null, adminRole: { in: ["SUPER", "SECURITY", "REVIEWER", "SUPPORT"] } }, select: { id: true, name: true, adminRole: true }, orderBy: { name: "asc" }, take: 100 })
      : Promise.resolve([]),
  ]);
  return NextResponse.json({ cases, verificationCases, moderationQueueCount, assignees }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const ctx = await adminContext();
  if (!ctx || ctx.role === "SUPPORT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = caseCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Provide a valid compliance case." }, { status: 400 });
  const input = parsed.data;
  const canCreate = ctx.role === "SUPER"
    || (ctx.role === "SECURITY" && ["INCIDENT", "PRIVACY_COMPLAINT"].includes(input.caseType))
    || (ctx.role === "REVIEWER" && ["COMPLAINT", "DISPUTE", "IP_REPORT", "MODERATION", "VERIFICATION"].includes(input.caseType));
  if (!canCreate) return NextResponse.json({ error: "This role cannot open that case type." }, { status: 403 });

  let merchantId = input.merchantId ?? null;
  if (input.listingId) {
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: input.listingId }, select: { id: true, merchantId: true } });
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (merchantId && listing.merchantId !== merchantId) return NextResponse.json({ error: "Listing and merchant references do not match." }, { status: 400 });
    merchantId = listing.merchantId;
  }
  if (input.reservationId) {
    const reservation = await prisma.reservation.findUnique({ where: { id: input.reservationId }, select: { id: true, merchantId: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    if (merchantId && merchantId !== reservation.merchantId) return NextResponse.json({ error: "Reservation and merchant references do not match." }, { status: 400 });
    merchantId = reservation.merchantId;
  }
  if (input.serviceBookingId) {
    const booking = await prisma.serviceBooking.findUnique({ where: { id: input.serviceBookingId }, select: { id: true, merchantId: true } });
    if (!booking) return NextResponse.json({ error: "Service appointment not found." }, { status: 404 });
    if (merchantId && merchantId !== booking.merchantId) return NextResponse.json({ error: "Appointment and merchant references do not match." }, { status: 400 });
    merchantId = booking.merchantId;
  }
  if (merchantId && !await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true } })) return NextResponse.json({ error: "Merchant not found." }, { status: 404 });
  let verificationCaseId: string | null = null;
  if (input.verificationCaseId) {
    const verification = await prisma.verificationCase.findUnique({ where: { id: input.verificationCaseId }, select: { id: true, merchantId: true } });
    if (!verification) return NextResponse.json({ error: "Verification case not found." }, { status: 404 });
    if (merchantId && merchantId !== verification.merchantId) return NextResponse.json({ error: "Verification case and merchant references do not match." }, { status: 400 });
    merchantId = verification.merchantId;
    verificationCaseId = verification.id;
  }

  const awarenessAt = input.awarenessAt ? new Date(input.awarenessAt) : null;
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.complianceCase.create({
      data: {
        caseCode: makeCaseCode(), caseType: input.caseType, status: "OPEN", priority: input.priority ?? (input.caseType === "INCIDENT" ? "CRITICAL" : "NORMAL"),
        title: input.title, reporterSummary: input.reporterSummary, reporterId: null, merchantId,
        listingId: input.listingId ?? null, reservationId: input.reservationId ?? null, serviceBookingId: input.serviceBookingId ?? null,
        verificationCaseId, awarenessAt, incidentKind: input.incidentKind ?? null, riskAssessment: input.caseType === "INCIDENT" ? "UNKNOWN" : null,
        nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
      },
    });
    await tx.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "CREATED", visibility: "INTERNAL", message: "Case opened by an authorized operations user." } });
    if (input.caseType === "INCIDENT") {
      const reviewDue = input.incidentKind === "PERSONAL_DATA_BREACH" && awarenessAt ? new Date(awarenessAt.getTime() + 72 * 60 * 60 * 1000) : (input.nextReviewAt ? new Date(input.nextReviewAt) : null);
      await tx.complianceTask.create({
        data: {
          caseId: record.id,
          title: input.incidentKind === "PERSONAL_DATA_BREACH" ? "Assess risk, containment, and whether any privacy notification duty applies" : "Assess containment, reporting route, and next operational steps",
          status: "OPEN", assigneeId: ctx.user.id, createdById: ctx.user.id, dueAt: reviewDue, nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
        },
      });
    }
    await tx.auditLog.create({ data: { actorId: ctx.user.id, action: `COMPLIANCE_${input.caseType}_OPENED`, resourceType: "ComplianceCase", resourceId: record.id, outcome: "OPEN", metadata: JSON.stringify({ caseCode: record.caseCode, priority: record.priority, incidentKind: input.incidentKind ?? null }) } });
    return record;
  });
  return NextResponse.json({ case: { id: created.id, caseCode: created.caseCode, caseType: created.caseType, status: created.status, createdAt: created.createdAt } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Provide a valid compliance action." }, { status: 400 });
  const input = parsed.data;

  if (input.action === "verification-update") {
    if (!["SUPER", "SECURITY", "REVIEWER"].includes(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (input.stage === "APPROVED") return NextResponse.json({ error: "Verification cannot be marked approved: no secure evidence-storage or independent credential-validation provider is configured. This workspace records review status only." }, { status: 409 });
    const current = await prisma.verificationCase.findUnique({ where: { id: input.verificationCaseId }, select: { id: true, merchantId: true, stage: true } });
    if (!current) return NextResponse.json({ error: "Verification case not found." }, { status: 404 });
    const updated = await prisma.verificationCase.update({
      where: { id: current.id },
      data: { stage: input.stage, outcomeNote: input.outcomeNote, nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null, reviewerId: ctx.user.id },
      select: { id: true, merchantId: true, stage: true, outcomeNote: true, nextReviewAt: true, updatedAt: true },
    });
    await prisma.auditLog.create({ data: { actorId: ctx.user.id, action: "VERIFICATION_CASE_STAGE_UPDATE", resourceType: "VerificationCase", resourceId: current.id, previousState: current.stage, newState: input.stage, outcome: input.stage, metadata: JSON.stringify({ noteStored: true }) } });
    return NextResponse.json({ verificationCase: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "assign") {
    if (ctx.role === "SUPPORT") return NextResponse.json({ error: "Support users cannot assign cases." }, { status: 403 });
    const record = await prisma.complianceCase.findUnique({ where: { id: input.caseId }, select: { id: true, caseType: true, assignedToId: true } });
    if (!record || !caseTypeManageableByRole(ctx.role, record.caseType, record.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Case not found or assignment is not permitted." }, { status: 404 });
    if (input.assigneeId) {
      const target = await prisma.user.findFirst({ where: { id: input.assigneeId, isAdmin: true, status: "ACTIVE", deletedAt: null }, select: { id: true, adminRole: true } });
      if (!target || !caseTypeVisibleToRole(target.adminRole, record.caseType, target.id, target.id)) return NextResponse.json({ error: "Choose an active operations user with access to this case type." }, { status: 400 });
    }
    const updated = await prisma.complianceCase.update({ where: { id: record.id }, data: { assignedToId: input.assigneeId }, select: { id: true, assignedToId: true } });
    await prisma.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "ASSIGNED", visibility: "INTERNAL", message: input.assigneeId ? "Case owner changed." : "Case owner cleared." } });
    await prisma.auditLog.create({ data: { actorId: ctx.user.id, action: "COMPLIANCE_CASE_ASSIGNED", resourceType: "ComplianceCase", resourceId: record.id, outcome: input.assigneeId ? "ASSIGNED" : "UNASSIGNED", metadata: JSON.stringify({ assigneeId: input.assigneeId }) } });
    return NextResponse.json({ case: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "transition") {
    const record = await prisma.complianceCase.findUnique({ where: { id: input.caseId }, select: { id: true, caseCode: true, caseType: true, status: true, priority: true, assignedToId: true, awarenessAt: true } });
    if (!record || !caseTypeManageableByRole(ctx.role, record.caseType, record.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Case not found or access is not permitted." }, { status: 404 });
    if (!canTransitionCase(record.status, input.status)) return NextResponse.json({ error: `Case cannot move from ${record.status} to ${input.status}.` }, { status: 409 });
    if (["RESOLVED", "CLOSED"].includes(input.status) && (!input.outcome || !input.outcomeSummary)) return NextResponse.json({ error: "A resolved or closed case requires an outcome and a recorded rationale." }, { status: 400 });
    if (record.caseType === "INCIDENT" && ctx.role !== "SUPER" && ctx.role !== "SECURITY") return NextResponse.json({ error: "Only security operations can update incident assessments." }, { status: 403 });
    if (input.externalReportReference && !isOpaqueEvidenceReference(input.externalReportReference)) return NextResponse.json({ error: "Use an opaque internal reference, not a URL or document body." }, { status: 400 });

    const data = {
      status: input.status,
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(input.nextReviewAt !== undefined ? { nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.outcomeSummary ? { outcomeSummary: input.outcomeSummary } : {}),
      ...(input.riskAssessment ? { riskAssessment: input.riskAssessment } : {}),
      ...(input.containmentSummary ? { containmentSummary: input.containmentSummary } : {}),
      ...(input.ndpcNotifiedAt !== undefined ? { ndpcNotifiedAt: input.ndpcNotifiedAt ? new Date(input.ndpcNotifiedAt) : null } : {}),
      ...(input.dataSubjectsNotifiedAt !== undefined ? { dataSubjectsNotifiedAt: input.dataSubjectsNotifiedAt ? new Date(input.dataSubjectsNotifiedAt) : null } : {}),
      ...(input.externalReportReference !== undefined ? { externalReportReference: input.externalReportReference } : {}),
      resolvedAt: ["RESOLVED", "CLOSED"].includes(input.status) ? new Date() : null,
      closedAt: input.status === "CLOSED" ? new Date() : null,
      ...(input.status === "IN_PROGRESS" && ["RESOLVED", "CLOSED", "REJECTED"].includes(record.status) ? { outcome: null, outcomeSummary: null } : {}),
      ...(input.publicSummary ? { publicSummary: input.publicSummary } : {}),
    };
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.complianceCase.updateMany({ where: { id: record.id, status: record.status }, data });
      if (changed.count !== 1) throw new Error("CASE_CHANGED");
      const result = await tx.complianceCase.findUniqueOrThrow({ where: { id: record.id }, select: { id: true, caseCode: true, status: true, priority: true, outcome: true, dueAt: true, nextReviewAt: true } });
      if (record.status !== input.status) await tx.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "STATUS_CHANGED", fromStatus: record.status, toStatus: input.status, visibility: "INTERNAL", message: input.status === "RESOLVED" || input.status === "CLOSED" ? "Case status changed with outcome recorded." : "Case status changed." } });
      if (input.publicSummary) await tx.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "PUBLIC_UPDATE", visibility: "REPORTER", message: input.publicSummary } });
      if (input.internalNote) await tx.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "INTERNAL_NOTE", visibility: "INTERNAL", message: input.internalNote } });
      await tx.auditLog.create({ data: { actorId: ctx.user.id, action: "COMPLIANCE_CASE_UPDATED", resourceType: "ComplianceCase", resourceId: record.id, previousState: record.status, newState: input.status, outcome: input.outcome ?? input.status, metadata: JSON.stringify({ priority: input.priority ?? record.priority, publicUpdate: Boolean(input.publicSummary), internalNote: Boolean(input.internalNote) }) } });
      return result;
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.message === "CASE_CHANGED") return null;
      throw cause;
    });
    if (!updated) return NextResponse.json({ error: "Another operator changed this case. Refresh before retrying." }, { status: 409 });
    return NextResponse.json({ case: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "add-task") {
    const record = await prisma.complianceCase.findUnique({ where: { id: input.caseId }, select: { id: true, caseType: true, assignedToId: true } });
    if (!record || !caseTypeManageableByRole(ctx.role, record.caseType, record.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Case not found or access is not permitted." }, { status: 404 });
    if (input.assigneeId) {
      const target = await prisma.user.findFirst({ where: { id: input.assigneeId, isAdmin: true, status: "ACTIVE", deletedAt: null }, select: { id: true, adminRole: true } });
      if (!target || !caseTypeVisibleToRole(target.adminRole, record.caseType, target.id, target.id)) return NextResponse.json({ error: "Choose an active operations user with access to this case type." }, { status: 400 });
    }
    const task = await prisma.complianceTask.create({ data: { caseId: record.id, title: input.title, assigneeId: input.assigneeId ?? null, createdById: ctx.user.id, dueAt: input.dueAt ? new Date(input.dueAt) : null, nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null } });
    await prisma.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "TASK_CREATED", visibility: "INTERNAL", message: "Operational task created." } });
    await prisma.auditLog.create({ data: { actorId: ctx.user.id, action: "COMPLIANCE_TASK_CREATED", resourceType: "ComplianceTask", resourceId: task.id, outcome: task.status, metadata: JSON.stringify({ caseId: record.id, assigned: Boolean(task.assigneeId), dueAt: task.dueAt }) } });
    return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "update-task") {
    const task = await prisma.complianceTask.findUnique({ where: { id: input.taskId }, include: { case: { select: { id: true, caseType: true, assignedToId: true } } } });
    if (!task || !caseTypeManageableByRole(ctx.role, task.case.caseType, task.case.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Task not found or access is not permitted." }, { status: 404 });
    if (ctx.role === "SUPPORT" && task.assigneeId !== ctx.user.id) return NextResponse.json({ error: "Only the task owner can update this task." }, { status: 403 });
    if (input.status === "DONE" && !input.outcome) return NextResponse.json({ error: "Record an outcome before marking the task done." }, { status: 400 });
    const updated = await prisma.complianceTask.update({
      where: { id: task.id },
      data: { status: input.status, ...(input.outcome ? { outcome: input.outcome } : {}), ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}), ...(input.nextReviewAt !== undefined ? { nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null } : {}), completedAt: input.status === "DONE" ? new Date() : null },
    });
    await prisma.complianceCaseEvent.create({ data: { caseId: task.case.id, actorId: ctx.user.id, eventType: "TASK_UPDATED", visibility: "INTERNAL", message: `Task status changed to ${input.status}.` } });
    await prisma.auditLog.create({ data: { actorId: ctx.user.id, action: "COMPLIANCE_TASK_UPDATED", resourceType: "ComplianceTask", resourceId: task.id, previousState: task.status, newState: input.status, outcome: input.status } });
    return NextResponse.json({ task: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "add-evidence-reference") {
    if (!["SUPER", "SECURITY"].includes(ctx.role)) return NextResponse.json({ error: "Evidence references are restricted to security and SUPER roles." }, { status: 403 });
    if (!isOpaqueEvidenceReference(input.referenceCode)) return NextResponse.json({ error: "Use an opaque internal reference, not a URL, local path, or document body." }, { status: 400 });
    const record = await prisma.complianceCase.findUnique({ where: { id: input.caseId }, select: { id: true, caseType: true, assignedToId: true } });
    if (!record || !caseTypeManageableByRole(ctx.role, record.caseType, record.assignedToId, ctx.user.id)) return NextResponse.json({ error: "Case not found or access is not permitted." }, { status: 404 });
    const evidence = await prisma.complianceEvidence.create({ data: { caseId: record.id, evidenceType: input.evidenceType, referenceCode: input.referenceCode, summary: input.summary || null, addedById: ctx.user.id } });
    await prisma.complianceCaseEvent.create({ data: { caseId: record.id, actorId: ctx.user.id, eventType: "EVIDENCE_REFERENCED", visibility: "INTERNAL", message: "An opaque evidence reference was added; no file was uploaded." } });
    await prisma.auditLog.create({ data: { actorId: ctx.user.id, action: "COMPLIANCE_EVIDENCE_REFERENCE_ADDED", resourceType: "ComplianceEvidence", resourceId: evidence.id, outcome: "RECORDED", metadata: JSON.stringify({ caseId: record.id, evidenceType: input.evidenceType }) } });
    return NextResponse.json({ evidence: { id: evidence.id, evidenceType: evidence.evidenceType, referenceCode: evidence.referenceCode, createdAt: evidence.createdAt } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json({ error: "Unsupported compliance action." }, { status: 400 });
}
