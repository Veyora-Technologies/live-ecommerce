import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentPublishedPolicies, getLegalReleaseGate, isPolicyKey, POLICY_SPECS } from "@/lib/legal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const merchantId = request.nextUrl.searchParams.get("merchantId")?.trim() || "";
  if (merchantId) {
    if (!user) return NextResponse.json({ error: "Sign in to view seller agreement status." }, { status: 401 });
    const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, ownerId: user.id }, select: { id: true } });
    if (!merchant) return NextResponse.json({ error: "Seller agreement status is not available for this business." }, { status: 404 });
  }

  const [published, marketplaceGate, accountGate, profile] = await Promise.all([
    currentPublishedPolicies(),
    getLegalReleaseGate("MARKETPLACE"),
    getLegalReleaseGate("ACCOUNT"),
    prisma.legalOperatorProfile.findUnique({
      where: { id: "primary" },
      select: {
        legalName: true,
        tradingName: true,
        entityType: true,
        registrationNumber: true,
        registeredAddress: true,
        jurisdiction: true,
        publicContactEmail: true,
        privacyContactEmail: true,
        complaintsContactEmail: true,
        publicPhone: true,
      },
    }),
  ]);

  const policies = await Promise.all(published.flatMap(async (policy) => {
    if (!isPolicyKey(policy.key)) return [];
    const expectedMode = POLICY_SPECS[policy.key].acceptanceMode;
    let accepted = false;
    if (user) {
      const isSellerAgreement = policy.key === "SELLER_AGREEMENT";
      const acceptance = await prisma.legalPolicyAcceptance.findFirst({
        where: {
          userId: user.id,
          policyId: policy.id,
          merchantId: isSellerAgreement ? merchantId || null : null,
        },
        select: { action: true },
      });
      accepted = acceptance?.action === (expectedMode === "ACCEPT" ? "ACCEPTED" : "ACKNOWLEDGED");
    }
    return [{
      id: policy.id,
      key: policy.key,
      version: policy.version,
      title: policy.title,
      content: policy.content,
      acceptanceMode: expectedMode,
      effectiveAt: policy.effectiveAt,
      accepted,
    }];
  }));

  return NextResponse.json({
    operator: profile,
    policies: policies.flat(),
    gate: {
      ready: marketplaceGate.ready,
      message: marketplaceGate.publicMessage,
      required: marketplaceGate.requiredPolicyKeys,
      bypassedOutsideProduction: marketplaceGate.bypassedOutsideProduction,
    },
    accountGate: {
      ready: accountGate.ready,
      message: accountGate.publicMessage,
      required: accountGate.requiredPolicyKeys,
      bypassedOutsideProduction: accountGate.bypassedOutsideProduction,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
