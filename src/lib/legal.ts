import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getEnvStatus } from "./env";
import { isOpaqueEvidenceReference } from "./compliance-access";

export const POLICY_SPECS = {
  PLATFORM_TERMS: { label: "Furnivo Platform Terms", acceptanceMode: "ACCEPT" },
  PRIVACY_NOTICE: { label: "Privacy Notice", acceptanceMode: "ACKNOWLEDGE" },
  CONSUMER_TERMS: { label: "Consumer Marketplace Terms", acceptanceMode: "ACCEPT" },
  SELLER_AGREEMENT: { label: "Seller Agreement", acceptanceMode: "ACCEPT" },
  COMPLAINTS_PROCESS: { label: "Complaints and Disputes Process", acceptanceMode: "ACKNOWLEDGE" },
  IP_REPORTING: { label: "Intellectual Property Reporting Process", acceptanceMode: "ACKNOWLEDGE" },
  VERIFICATION_SCOPE: { label: "Seller Review and Verification Scope", acceptanceMode: "ACKNOWLEDGE" },
  PRODUCT_DISCLOSURES: { label: "Product Listing Disclosures", acceptanceMode: "ACKNOWLEDGE" },
  SERVICE_DISCLOSURES: { label: "Service Booking Disclosures", acceptanceMode: "ACKNOWLEDGE" },
  SERVICE_SCOPE: { label: "Service Category Scope and Safeguards", acceptanceMode: "ACKNOWLEDGE" },
} as const;

export type PolicyKey = keyof typeof POLICY_SPECS;
export function isPolicyKey(value: string): value is PolicyKey {
  return Object.prototype.hasOwnProperty.call(POLICY_SPECS, value);
}
export type LegalFeature = "ACCOUNT" | "MARKETPLACE";
export const ACCOUNT_POLICY_KEYS: PolicyKey[] = ["PLATFORM_TERMS", "PRIVACY_NOTICE"];
export const MARKETPLACE_POLICY_KEYS: PolicyKey[] = [
  ...ACCOUNT_POLICY_KEYS,
  "CONSUMER_TERMS",
  "SELLER_AGREEMENT",
  "COMPLAINTS_PROCESS",
  "IP_REPORTING",
  "VERIFICATION_SCOPE",
  "PRODUCT_DISCLOSURES",
  "SERVICE_DISCLOSURES",
  "SERVICE_SCOPE",
];

export type LegalGateResult = {
  enabled: boolean;
  ready: boolean;
  bypassedOutsideProduction: boolean;
  missing: string[];
  requiredPolicyKeys: PolicyKey[];
  publicMessage: string | null;
};

export type OperatorProfileForGate = {
  legalName: string | null;
  entityType: string | null;
  registeredAddress: string | null;
  jurisdiction: string | null;
  publicContactEmail: string | null;
  privacyContactEmail: string | null;
  complaintsContactEmail: string | null;
  reviewProfessional: string | null;
  reviewQualifications: string | null;
  reviewScope: string | null;
  reviewEvidenceReference: string | null;
  reviewedAt: Date | null;
};

export type PolicyForGate = {
  key: string;
  status: string;
  effectiveAt: Date | null;
  reviewProfessional: string | null;
  reviewQualifications: string | null;
  reviewScope: string | null;
  reviewEvidenceReference: string | null;
  reviewedAt: Date | null;
};

const requiredOperatorFields: Array<[keyof OperatorProfileForGate, string]> = [
  ["legalName", "operator legal name"],
  ["entityType", "operator entity type"],
  ["registeredAddress", "operator address"],
  ["jurisdiction", "operator jurisdiction"],
  ["publicContactEmail", "public contact email"],
  ["privacyContactEmail", "privacy contact email"],
  ["complaintsContactEmail", "complaints contact email"],
];

function isRecordedProfessionalReview(input: {
  reviewProfessional: string | null;
  reviewQualifications: string | null;
  reviewScope: string | null;
  reviewEvidenceReference: string | null;
  reviewedAt: Date | null;
}) {
  return Boolean(
    input.reviewProfessional?.trim() &&
    input.reviewQualifications?.trim() &&
    input.reviewScope?.trim() &&
    input.reviewEvidenceReference?.trim() &&
    isOpaqueEvidenceReference(input.reviewEvidenceReference) &&
    input.reviewedAt,
  );
}

export function evaluateLegalGate(
  feature: LegalFeature,
  profile: OperatorProfileForGate | null,
  policies: PolicyForGate[],
  now = new Date(),
): LegalGateResult {
  const requiredPolicyKeys = feature === "ACCOUNT" ? ACCOUNT_POLICY_KEYS : MARKETPLACE_POLICY_KEYS;
  const missing: string[] = [];
  if (!profile) {
    missing.push("operator identity and contact profile");
  } else {
    for (const [field, label] of requiredOperatorFields) {
      const value = profile[field];
      if (typeof value !== "string" || !value.trim()) missing.push(label);
    }
    if (!isRecordedProfessionalReview(profile)) missing.push("qualified review of the operator disclosure");
  }

  const activeByKey = new Map<string, PolicyForGate>();
  for (const policy of policies) {
    if (policy.status !== "PUBLISHED" || !policy.effectiveAt || policy.effectiveAt > now) continue;
    const current = activeByKey.get(policy.key);
    if (!current || policy.effectiveAt > (current.effectiveAt ?? new Date(0))) activeByKey.set(policy.key, policy);
  }
  for (const key of requiredPolicyKeys) {
    const policy = activeByKey.get(key);
    if (!policy) {
      missing.push(POLICY_SPECS[key].label);
      continue;
    }
    if (!isRecordedProfessionalReview(policy)) missing.push(`${POLICY_SPECS[key].label} review record`);
  }

  const ready = missing.length === 0;
  return {
    enabled: ready,
    ready,
    bypassedOutsideProduction: false,
    missing,
    requiredPolicyKeys,
    publicMessage: ready ? null : "This feature is not available in production because Furnivo has not yet published a complete, reviewed legal and trust-information package.",
  };
}

export async function getLegalReleaseGate(feature: LegalFeature = "MARKETPLACE"): Promise<LegalGateResult> {
  const requiredPolicyKeys = feature === "ACCOUNT" ? ACCOUNT_POLICY_KEYS : MARKETPLACE_POLICY_KEYS;
  if (process.env.NODE_ENV === "production" && !getEnvStatus().valid) {
    return {
      enabled: false,
      ready: false,
      bypassedOutsideProduction: false,
      missing: ["verified production database, migrations, and runtime configuration"],
      requiredPolicyKeys,
      publicMessage: "This feature is unavailable until Furnivo's production database and launch configuration have passed release review.",
    };
  }

  if (process.env.LIVE_DATA_MODE !== "production") {
    return {
      enabled: true,
      ready: true,
      bypassedOutsideProduction: true,
      missing: [],
      requiredPolicyKeys,
      publicMessage: null,
    };
  }

  const [profile, policies] = await Promise.all([
    prisma.legalOperatorProfile.findUnique({ where: { id: "primary" } }),
    prisma.legalPolicy.findMany({
      where: { key: { in: requiredPolicyKeys }, status: "PUBLISHED" },
      select: { key: true, status: true, effectiveAt: true, reviewProfessional: true, reviewQualifications: true, reviewScope: true, reviewEvidenceReference: true, reviewedAt: true },
    }),
  ]);
  return evaluateLegalGate(feature, profile, policies);
}

export async function currentPublishedPolicies(keys?: PolicyKey[]) {
  const now = new Date();
  const policies = await prisma.legalPolicy.findMany({
    where: {
      status: "PUBLISHED",
      effectiveAt: { lte: now },
      ...(keys?.length ? { key: { in: keys } } : {}),
    },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
  const current = new Map<string, (typeof policies)[number]>();
  for (const policy of policies) if (!current.has(policy.key)) current.set(policy.key, policy);
  return [...current.values()];
}

export async function requirePolicyAcceptances(input: {
  userId: string;
  keys: PolicyKey[];
  merchantId?: string;
}): Promise<{ allowed: boolean; code?: "LEGAL_RELEASE_GATE" | "POLICY_ACCEPTANCE_REQUIRED"; missing: PolicyKey[]; message?: string }> {
  if (process.env.NODE_ENV === "production" && !getEnvStatus().valid) {
    return { allowed: false, code: "LEGAL_RELEASE_GATE", missing: [], message: "Furnivo's production database and launch configuration have not passed release review." };
  }
  if (process.env.LIVE_DATA_MODE !== "production") return { allowed: true, missing: [] };
  const gate = await getLegalReleaseGate("MARKETPLACE");
  if (!gate.ready) return { allowed: false, code: "LEGAL_RELEASE_GATE", missing: [], message: gate.publicMessage ?? undefined };

  const policies = await currentPublishedPolicies(input.keys);
  const missing: PolicyKey[] = [];
  for (const key of input.keys) {
    const policy = policies.find((item) => item.key === key);
    if (!policy) {
      missing.push(key);
      continue;
    }
    const usesMerchantScope = key === "SELLER_AGREEMENT";
    if (usesMerchantScope && !input.merchantId) {
      missing.push(key);
      continue;
    }
    const acceptance = await prisma.legalPolicyAcceptance.findFirst({
      where: {
        userId: input.userId,
        policyId: policy.id,
        merchantId: usesMerchantScope ? input.merchantId : null,
      },
      select: { action: true },
    });
    const expectedAction = POLICY_SPECS[key].acceptanceMode === "ACCEPT" ? "ACCEPTED" : "ACKNOWLEDGED";
    if (acceptance?.action !== expectedAction) missing.push(key);
  }
  return missing.length
    ? { allowed: false, code: "POLICY_ACCEPTANCE_REQUIRED", missing, message: "Review and record the current Furnivo policy acknowledgements at /legal before continuing." }
    : { allowed: true, missing: [] };
}

export async function requireMerchantSellerAgreement(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true, ownerId: true } });
  if (!merchant) return { merchant: null, acceptance: { allowed: false, code: "POLICY_ACCEPTANCE_REQUIRED" as const, missing: ["SELLER_AGREEMENT" as const], message: "Merchant not found." } };
  const acceptance = await requirePolicyAcceptances({ userId: merchant.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: merchant.id });
  return { merchant, acceptance };
}

export async function getLegalReleaseGateInTransaction(tx: Prisma.TransactionClient, feature: LegalFeature = "MARKETPLACE"): Promise<LegalGateResult> {
  const requiredPolicyKeys = feature === "ACCOUNT" ? ACCOUNT_POLICY_KEYS : MARKETPLACE_POLICY_KEYS;
  if (process.env.NODE_ENV === "production" && !getEnvStatus().valid) {
    return {
      enabled: false,
      ready: false,
      bypassedOutsideProduction: false,
      missing: ["verified production database, migrations, and runtime configuration"],
      requiredPolicyKeys,
      publicMessage: "This feature is unavailable until Furnivo's production database and launch configuration have passed release review.",
    };
  }
  if (!isLegalProductionMode()) {
    return { enabled: true, ready: true, bypassedOutsideProduction: true, missing: [], requiredPolicyKeys, publicMessage: null };
  }
  const [profile, policies] = await Promise.all([
    tx.legalOperatorProfile.findUnique({ where: { id: "primary" } }),
    tx.legalPolicy.findMany({ where: { key: { in: requiredPolicyKeys }, status: "PUBLISHED" }, select: { key: true, status: true, effectiveAt: true, reviewProfessional: true, reviewQualifications: true, reviewScope: true, reviewEvidenceReference: true, reviewedAt: true } }),
  ]);
  return evaluateLegalGate(feature, profile, policies);
}

export async function requirePolicyAcceptancesInTransaction(tx: Prisma.TransactionClient, input: { userId: string; keys: PolicyKey[]; merchantId?: string }) {
  if (process.env.NODE_ENV === "production" && !getEnvStatus().valid) {
    return { allowed: false, missing: [] as PolicyKey[], code: "LEGAL_RELEASE_GATE" as const, message: "Furnivo's production database and launch configuration have not passed release review." };
  }
  if (!isLegalProductionMode()) return { allowed: true, missing: [] as PolicyKey[] };
  const gate = await getLegalReleaseGateInTransaction(tx, "MARKETPLACE");
  if (!gate.ready) return { allowed: false, missing: [] as PolicyKey[], code: "LEGAL_RELEASE_GATE" as const, message: gate.publicMessage ?? "Marketplace legal release is blocked." };
  const missing: PolicyKey[] = [];
  const now = new Date();
  for (const key of input.keys) {
    const policy = await tx.legalPolicy.findFirst({ where: { key, status: "PUBLISHED", effectiveAt: { lte: now } }, orderBy: { version: "desc" }, select: { id: true } });
    if (!policy) { missing.push(key); continue; }
    const sellerScoped = key === "SELLER_AGREEMENT";
    if (sellerScoped && !input.merchantId) { missing.push(key); continue; }
    const acceptance = await tx.legalPolicyAcceptance.findFirst({ where: { userId: input.userId, policyId: policy.id, merchantId: sellerScoped ? input.merchantId : null }, select: { action: true } });
    const expected = POLICY_SPECS[key].acceptanceMode === "ACCEPT" ? "ACCEPTED" : "ACKNOWLEDGED";
    if (acceptance?.action !== expected) missing.push(key);
  }
  return missing.length
    ? { allowed: false, missing, code: "POLICY_ACCEPTANCE_REQUIRED" as const, message: "The merchant owner has not accepted the current agreement for this business." }
    : { allowed: true, missing: [] as PolicyKey[] };
}

export function isLegalProductionMode() {
  return process.env.LIVE_DATA_MODE === "production";
}
