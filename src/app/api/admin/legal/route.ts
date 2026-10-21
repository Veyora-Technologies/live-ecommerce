import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isOpaqueEvidenceReference } from "@/lib/compliance-access";
import { getLegalReleaseGate, isPolicyKey, POLICY_SPECS } from "@/lib/legal";

export const dynamic = "force-dynamic";

async function requireSuper() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return null;
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  return full?.adminRole === "SUPER" ? user : null;
}

function operatorHasPublicDetails(profile: {
  legalName: string | null; entityType: string | null; registeredAddress: string | null; jurisdiction: string | null;
  publicContactEmail: string | null; privacyContactEmail: string | null; complaintsContactEmail: string | null;
}) {
  return Boolean(profile.legalName?.trim() && profile.entityType?.trim() && profile.registeredAddress?.trim() && profile.jurisdiction?.trim() && profile.publicContactEmail?.trim() && profile.privacyContactEmail?.trim() && profile.complaintsContactEmail?.trim());
}

function reviewIsRecorded(review: { reviewProfessional: string | null; reviewQualifications: string | null; reviewScope: string | null; reviewEvidenceReference: string | null; reviewedAt: Date | null }) {
  return Boolean(review.reviewProfessional?.trim() && review.reviewQualifications?.trim() && review.reviewScope?.trim() && review.reviewEvidenceReference?.trim() && isOpaqueEvidenceReference(review.reviewEvidenceReference) && review.reviewedAt);
}

const policyCreateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  title: z.string().trim().min(4).max(160),
  content: z.string().trim().min(100).max(50000),
}).strict();

const operatorSaveSchema = z.object({
  legalName: z.string().trim().max(160).optional().nullable(),
  tradingName: z.string().trim().max(160).optional().nullable(),
  entityType: z.string().trim().max(80).optional().nullable(),
  registrationNumber: z.string().trim().max(80).optional().nullable(),
  registeredAddress: z.string().trim().max(500).optional().nullable(),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  publicContactEmail: z.string().trim().email().max(254).optional().nullable(),
  privacyContactEmail: z.string().trim().email().max(254).optional().nullable(),
  complaintsContactEmail: z.string().trim().email().max(254).optional().nullable(),
  publicPhone: z.string().trim().max(40).optional().nullable(),
}).strict();

const reviewFieldsSchema = z.object({
  reviewProfessional: z.string().trim().min(2).max(160),
  reviewQualifications: z.string().trim().min(2).max(200),
  reviewScope: z.string().trim().min(10).max(2000),
  reviewEvidenceReference: z.string().trim().min(3).max(128),
}).strict();

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update-draft"), policyId: z.string().trim().min(1).max(64), title: z.string().trim().min(4).max(160), content: z.string().trim().min(100).max(50000) }).strict(),
  z.object({ action: z.literal("record-policy-review"), policyId: z.string().trim().min(1).max(64), ...reviewFieldsSchema.shape }).strict(),
  z.object({ action: z.literal("publish-policy"), policyId: z.string().trim().min(1).max(64) }).strict(),
  z.object({ action: z.literal("withdraw-policy"), policyId: z.string().trim().min(1).max(64), reason: z.string().trim().min(8).max(500) }).strict(),
  z.object({ action: z.literal("save-operator"), ...operatorSaveSchema.shape }).strict(),
  z.object({ action: z.literal("record-operator-review"), ...reviewFieldsSchema.shape }).strict(),
]);

export async function GET() {
  const user = await requireSuper();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [operator, policies, acceptances, accountGate, marketplaceGate] = await Promise.all([
    prisma.legalOperatorProfile.findUnique({ where: { id: "primary" } }),
    prisma.legalPolicy.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] }),
    prisma.legalPolicyAcceptance.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, userId: true, action: true, merchantId: true, createdAt: true, policy: { select: { key: true, version: true, title: true } }, merchant: { select: { businessName: true } }, user: { select: { name: true } } },
    }),
    getLegalReleaseGate("ACCOUNT"),
    getLegalReleaseGate("MARKETPLACE"),
  ]);
  return NextResponse.json({ operator, policies, acceptances, gates: { account: accountGate, marketplace: marketplaceGate } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await requireSuper();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = policyCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isPolicyKey(parsed.data?.key ?? "")) return NextResponse.json({ error: "Provide a supported policy key, title, and complete draft text. Live does not generate or publish legal wording." }, { status: 400 });
  const { key, title, content } = parsed.data;
  const latest = await prisma.legalPolicy.findFirst({ where: { key }, orderBy: { version: "desc" }, select: { version: true } });
  try {
    const policy = await prisma.legalPolicy.create({
      data: { key, version: (latest?.version ?? 0) + 1, title, content, acceptanceMode: POLICY_SPECS[key as keyof typeof POLICY_SPECS].acceptanceMode, status: "DRAFT", createdById: user.id },
      select: { id: true, key: true, version: true, title: true, status: true, createdAt: true },
    });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_POLICY_DRAFT_CREATED", resourceType: "LegalPolicy", resourceId: policy.id, outcome: "DRAFT", metadata: JSON.stringify({ key, version: policy.version }) } });
    return NextResponse.json({ policy }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "A policy version could not be created. Refresh the list and retry." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await requireSuper();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid policy or operator-profile action." }, { status: 400 });
  const input = parsed.data;

  if (input.action === "save-operator") {
    const clean = {
      legalName: input.legalName?.trim() || null,
      tradingName: input.tradingName?.trim() || null,
      entityType: input.entityType?.trim() || null,
      registrationNumber: input.registrationNumber?.trim() || null,
      registeredAddress: input.registeredAddress?.trim() || null,
      jurisdiction: input.jurisdiction?.trim() || null,
      publicContactEmail: input.publicContactEmail?.trim() || null,
      privacyContactEmail: input.privacyContactEmail?.trim() || null,
      complaintsContactEmail: input.complaintsContactEmail?.trim() || null,
      publicPhone: input.publicPhone?.trim() || null,
    };
    const operator = await prisma.legalOperatorProfile.upsert({
      where: { id: "primary" },
      create: { id: "primary", ...clean, updatedById: user.id },
      update: { ...clean, updatedById: user.id, reviewProfessional: null, reviewQualifications: null, reviewScope: null, reviewEvidenceReference: null, reviewedAt: null, reviewedById: null },
    });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_OPERATOR_PROFILE_UPDATED", resourceType: "LegalOperatorProfile", resourceId: "primary", outcome: "UPDATED", metadata: JSON.stringify({ fields: Object.keys(clean) }) } });
    return NextResponse.json({ operator }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "record-operator-review") {
    const profile = await prisma.legalOperatorProfile.findUnique({ where: { id: "primary" } });
    if (!profile || !operatorHasPublicDetails(profile)) return NextResponse.json({ error: "Complete the actual operator identity and public contact fields before recording review." }, { status: 409 });
    if (profile.updatedById === user.id) return NextResponse.json({ error: "A different SUPER administrator must record the review; the profile editor cannot review their own changes." }, { status: 409 });
    if (!isOpaqueEvidenceReference(input.reviewEvidenceReference)) return NextResponse.json({ error: "Use an opaque internal evidence reference, not a URL or document body." }, { status: 400 });
    const operator = await prisma.legalOperatorProfile.update({
      where: { id: "primary" },
      data: { reviewProfessional: input.reviewProfessional, reviewQualifications: input.reviewQualifications, reviewScope: input.reviewScope, reviewEvidenceReference: input.reviewEvidenceReference, reviewedAt: new Date(), reviewedById: user.id },
    });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_OPERATOR_REVIEW_RECORDED", resourceType: "LegalOperatorProfile", resourceId: "primary", outcome: "RECORDED", metadata: JSON.stringify({ reviewProfessional: input.reviewProfessional, evidenceReferenceStored: true }) } });
    return NextResponse.json({ operator }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const policyId = "policyId" in input ? input.policyId : "";
  const policy = await prisma.legalPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return NextResponse.json({ error: "Policy version not found." }, { status: 404 });

  if (input.action === "update-draft") {
    if (policy.status !== "DRAFT") return NextResponse.json({ error: "Published or review-recorded policy versions are immutable; create a new draft version." }, { status: 409 });
    const updated = await prisma.legalPolicy.update({ where: { id: policy.id }, data: { title: input.title, content: input.content } });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_POLICY_DRAFT_UPDATED", resourceType: "LegalPolicy", resourceId: policy.id, outcome: "UPDATED", metadata: JSON.stringify({ key: policy.key, version: policy.version }) } });
    return NextResponse.json({ policy: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "record-policy-review") {
    if (policy.status !== "DRAFT") return NextResponse.json({ error: "Only a final draft can receive a review record." }, { status: 409 });
    if (!isOpaqueEvidenceReference(input.reviewEvidenceReference)) return NextResponse.json({ error: "Use an opaque internal evidence reference, not a URL or document body." }, { status: 400 });
    const updated = await prisma.legalPolicy.update({
      where: { id: policy.id },
      data: { status: "REVIEW_RECORDED", reviewProfessional: input.reviewProfessional, reviewQualifications: input.reviewQualifications, reviewScope: input.reviewScope, reviewEvidenceReference: input.reviewEvidenceReference, reviewedAt: new Date() },
    });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_POLICY_REVIEW_RECORDED", resourceType: "LegalPolicy", resourceId: policy.id, outcome: "RECORDED", metadata: JSON.stringify({ key: policy.key, version: policy.version, reviewProfessional: input.reviewProfessional, evidenceReferenceStored: true }) } });
    return NextResponse.json({ policy: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "publish-policy") {
    if (policy.status !== "REVIEW_RECORDED" || !reviewIsRecorded(policy)) return NextResponse.json({ error: "Record qualified external review against this exact immutable draft before publishing." }, { status: 409 });
    if (policy.createdById === user.id) return NextResponse.json({ error: "A different SUPER administrator must publish; the drafter cannot publish their own version." }, { status: 409 });
    const profile = await prisma.legalOperatorProfile.findUnique({ where: { id: "primary" } });
    if (!profile || !operatorHasPublicDetails(profile) || !reviewIsRecorded(profile)) return NextResponse.json({ error: "Complete and independently review the actual operator identity/contact profile before publishing any operative policy." }, { status: 409 });
    const now = new Date();
    const published = await prisma.$transaction(async (tx) => {
      await tx.legalPolicy.updateMany({ where: { key: policy.key, status: "PUBLISHED" }, data: { status: "SUPERSEDED", supersededAt: now } });
      return tx.legalPolicy.update({ where: { id: policy.id }, data: { status: "PUBLISHED", publishedAt: now, effectiveAt: now, publishedById: user.id } });
    });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_POLICY_PUBLISHED", resourceType: "LegalPolicy", resourceId: policy.id, outcome: "PUBLISHED", metadata: JSON.stringify({ key: policy.key, version: policy.version }) } });
    return NextResponse.json({ policy: published }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.action === "withdraw-policy") {
    if (policy.status !== "PUBLISHED") return NextResponse.json({ error: "Only a published policy can be withdrawn." }, { status: 409 });
    const now = new Date();
    const updated = await prisma.legalPolicy.update({ where: { id: policy.id }, data: { status: "WITHDRAWN", supersededAt: now } });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "LEGAL_POLICY_WITHDRAWN", resourceType: "LegalPolicy", resourceId: policy.id, outcome: "WITHDRAWN", metadata: JSON.stringify({ key: policy.key, version: policy.version, reason: input.reason }) } });
    return NextResponse.json({ policy: updated }, { headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json({ error: "Unsupported legal operations action." }, { status: 400 });
}
