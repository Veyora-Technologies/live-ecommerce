import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionForUser, cookieOptions, AUTH_COOKIE } from "@/lib/auth";
import { registerSchema, parseOr400 } from "@/lib/validate";
import { logSecurityEvent } from "@/lib/security";
import { ACCOUNT_POLICY_KEYS, evaluateLegalGate, getLegalReleaseGate, isLegalProductionMode, POLICY_SPECS, type PolicyKey } from "@/lib/legal";

class RegistrationLegalBlock extends Error {
  constructor(
    readonly status: 428 | 503,
    readonly code: "LEGAL_RELEASE_GATE" | "POLICY_ACCEPTANCE_REQUIRED",
    readonly missing: PolicyKey[],
    message: string,
  ) {
    super(message);
    this.name = "RegistrationLegalBlock";
  }
}

export async function POST(req: NextRequest) {
  const parsed = parseOr400(registerSchema, await req.json().catch(() => ({})));
  if ("response" in parsed) return parsed.response;
  const { name, email, phone, password, policyAcceptances = [] } = parsed.data;
  if (!email && !phone) return NextResponse.json({ error: "Email or phone required" }, { status: 400 });
  // Role/admin fields from the client are ignored entirely — accounts always start as CONSUMER.

  const production = isLegalProductionMode();
  const accountGate = await getLegalReleaseGate("ACCOUNT");
  if (process.env.NODE_ENV === "production" && !accountGate.ready) {
    return NextResponse.json({ error: accountGate.publicMessage, code: "LEGAL_RELEASE_GATE" }, { status: 503 });
  }

  const or: Prisma.UserWhereInput[] = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  const existing = or.length ? await prisma.user.findFirst({ where: { OR: or } }) : null;
  if (existing) return NextResponse.json({ error: "Account already exists. Please sign in or reset your password." }, { status: 409 });

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      let currentPolicies: Awaited<ReturnType<typeof tx.legalPolicy.findMany>> = [];
      if (production) {
        const [profile, publishedPolicies] = await Promise.all([
          tx.legalOperatorProfile.findUnique({ where: { id: "primary" } }),
          tx.legalPolicy.findMany({
            where: { key: { in: [...ACCOUNT_POLICY_KEYS] }, status: "PUBLISHED", effectiveAt: { lte: new Date() } },
            orderBy: [{ key: "asc" }, { version: "desc" }],
          }),
        ]);
        const gate = evaluateLegalGate("ACCOUNT", profile, publishedPolicies);
        if (!gate.ready) {
          throw new RegistrationLegalBlock(503, "LEGAL_RELEASE_GATE", [], gate.publicMessage ?? "Account registration is not available in production.");
        }
        const byKey = new Map<string, (typeof publishedPolicies)[number]>();
        for (const policy of publishedPolicies) if (!byKey.has(policy.key)) byKey.set(policy.key, policy);
        currentPolicies = ACCOUNT_POLICY_KEYS.flatMap((key) => {
          const policy = byKey.get(key);
          return policy ? [policy] : [];
        });
        const submittedIds = new Set(policyAcceptances.map((item) => item.policyId));
        const missing = ACCOUNT_POLICY_KEYS.filter((key) => {
          const policy = byKey.get(key);
          return !policy || !submittedIds.has(policy.id);
        });
        if (missing.length) {
          throw new RegistrationLegalBlock(428, "POLICY_ACCEPTANCE_REQUIRED", missing, "Review the current Platform Terms and Privacy Notice before creating an account.");
        }
      }

      const created = await tx.user.create({
        data: { name, email: email || null, phone: phone || null, passwordHash, role: "CONSUMER", isAdmin: false, adminRole: "NONE", passwordChangedAt: new Date() },
      });
      for (const policy of currentPolicies) {
        const key = policy.key as PolicyKey;
        const action = POLICY_SPECS[key].acceptanceMode === "ACCEPT" ? "ACCEPTED" : "ACKNOWLEDGED";
        await tx.legalPolicyAcceptance.create({
          data: { userId: created.id, policyId: policy.id, action, merchantId: null },
        });
      }
      return created;
    });
  } catch (cause) {
    if (cause instanceof RegistrationLegalBlock) {
      return NextResponse.json({ error: cause.message, code: cause.code, missingPolicies: cause.missing }, { status: cause.status });
    }
    throw cause;
  }

  await logSecurityEvent("REGISTER", { userId: user.id, headers: req.headers });
  const { token } = await createSessionForUser(user, req.headers);
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  res.cookies.set(AUTH_COOKIE, token, cookieOptions());
  res.cookies.set("live_theme", user.theme || "system", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
