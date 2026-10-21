import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLegalReleaseGate, isPolicyKey, POLICY_SPECS } from "@/lib/legal";

export const dynamic = "force-dynamic";
const schema = z.object({ policyId: z.string().trim().min(1).max(64), merchantId: z.string().trim().min(1).max(64).optional() }).strict();

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a published policy to acknowledge." }, { status: 400 });
  const { policyId, merchantId } = parsed.data;
  const policy = await prisma.legalPolicy.findFirst({
    where: { id: policyId, status: "PUBLISHED", effectiveAt: { lte: new Date() } },
    select: { id: true, key: true, acceptanceMode: true, version: true },
  });
  if (!policy || !isPolicyKey(policy.key)) return NextResponse.json({ error: "That policy version is not currently published." }, { status: 404 });
  const spec = POLICY_SPECS[policy.key];
  if (policy.acceptanceMode !== spec.acceptanceMode) {
    return NextResponse.json({ error: "This policy does not accept this acknowledgement action." }, { status: 409 });
  }

  const gate = await getLegalReleaseGate(policy.key === "PLATFORM_TERMS" || policy.key === "PRIVACY_NOTICE" ? "ACCOUNT" : "MARKETPLACE");
  if (!gate.ready) return NextResponse.json({ error: gate.publicMessage }, { status: 503 });

  if (policy.key === "SELLER_AGREEMENT") {
    if (!merchantId) return NextResponse.json({ error: "Choose the business whose seller agreement you are accepting." }, { status: 400 });
    const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, ownerId: user.id }, select: { id: true } });
    if (!merchant) return NextResponse.json({ error: "Only the business owner can accept this seller agreement." }, { status: 403 });
  } else if (merchantId) {
    return NextResponse.json({ error: "A business scope is only valid for the seller agreement." }, { status: 400 });
  }

  const action = spec.acceptanceMode === "ACCEPT" ? "ACCEPTED" : "ACKNOWLEDGED";
  const existing = await prisma.legalPolicyAcceptance.findFirst({
    where: { userId: user.id, policyId: policy.id, merchantId: policy.key === "SELLER_AGREEMENT" ? merchantId : null },
    select: { id: true, action: true },
  });
  const saved = existing
    ? await prisma.legalPolicyAcceptance.update({ where: { id: existing.id }, data: { action } })
    : await prisma.legalPolicyAcceptance.create({ data: { userId: user.id, policyId: policy.id, merchantId: policy.key === "SELLER_AGREEMENT" ? merchantId : null, action } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: `LEGAL_POLICY_${action}`,
      resourceType: "LegalPolicy",
      resourceId: policy.id,
      outcome: action,
      metadata: JSON.stringify({ key: policy.key, version: policy.version, merchantScoped: policy.key === "SELLER_AGREEMENT" }),
    },
  });
  return NextResponse.json({ ok: true, policyId: policy.id, key: policy.key, version: policy.version, action: saved.action }, { headers: { "Cache-Control": "private, no-store" } });
}
