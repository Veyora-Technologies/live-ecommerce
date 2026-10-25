import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionForUser, cookieOptions, AUTH_COOKIE } from "@/lib/auth";
import { registerSchema, parseOr400 } from "@/lib/validate";
import { logSecurityEvent, randomToken, sha256 } from "@/lib/security";
import { emailConfigured, emailLinkBase, sendEmail } from "@/lib/email";
import { ACCOUNT_POLICY_KEYS, evaluateLegalGate, getLegalReleaseGate, isLegalProductionMode, POLICY_SPECS, type PolicyKey } from "@/lib/legal";

/** A concurrent or repeat sign-up for the same email/phone. Maps to 409, not 500. */
class RegistrationConflict extends Error {
  constructor(readonly field: "email" | "phone") {
    super("Account already exists. Please sign in or reset your password.");
    this.name = "RegistrationConflict";
  }
}

function isUniqueConstraintError(cause: unknown): boolean {
  // Prisma P2002 = unique constraint failed. Matched structurally so this file
  // does not depend on a generated Prisma namespace import.
  return Boolean(cause && typeof cause === "object" && (cause as { code?: unknown }).code === "P2002");
}

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

/**
 * Create a single-use verification challenge and an in-app notification.
 * Returns the raw token only so non-production callers can display it; the
 * database stores a SHA-256 hash.
 */
async function issueContactVerification(userId: string, email: string | null | undefined, phone: string | null | undefined) {
  const destination = email ? "EMAIL" : phone ? "PHONE" : null;
  if (!destination) return null;
  await prisma.tokenChallenge.updateMany({ where: { userId, type: "VERIFY_CONTACT", usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await prisma.tokenChallenge.create({
    data: { userId, type: "VERIFY_CONTACT", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 3600000) },
  });
  let delivered = false;
  let deliveryReason: string | null = null;
  if (destination === "EMAIL" && email && emailConfigured() && emailLinkBase()) {
    const result = await sendEmail({
      to: email,
      subject: "Confirm your Furnivo email address",
      text: [
        "Confirm the email address on your Furnivo account.",
        "",
        `Open this link within 24 hours: ${emailLinkBase()}/auth/verify?token=${encodeURIComponent(raw)}`,
        "",
        "If you did not create a Furnivo account, ignore this message.",
      ].join("\n"),
      idempotencyKey: `verify:${userId}`,
    });
    delivered = result.delivered;
    if (!result.delivered) deliveryReason = result.reason;
  }
  await prisma.notification.create({
    data: {
      recipientId: userId,
      type: "SECURITY",
      title: "Verify your contact details",
      body: delivered
        ? `A verification link was sent to your ${destination.toLowerCase()}. Your account stays unverified until it is opened.`
        : `A verification request was created for your ${destination.toLowerCase()}, but no message was delivered because no sender is configured in this build.`,
    },
  }).catch(() => {});
  return { channel: destination, token: raw, expiresInHours: 24, delivered, deliveryReason };
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

      let created;
      try {
        created = await tx.user.create({
          data: { name, email: email || null, phone: phone || null, passwordHash, role: "CONSUMER", isAdmin: false, adminRole: "NONE", passwordChangedAt: new Date() },
        });
      } catch (cause) {
        // Two concurrent sign-ups can both pass the pre-check above; the unique
        // constraint is the real guard. Report a clean 409 instead of a 500.
        if (isUniqueConstraintError(cause)) {
          const target = String((cause as { meta?: { target?: unknown } }).meta?.target ?? "");
          throw new RegistrationConflict(target.includes("phone") ? "phone" : "email");
        }
        throw cause;
      }
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
    if (cause instanceof RegistrationConflict) {
      return NextResponse.json({ error: cause.message, code: "ACCOUNT_EXISTS", field: cause.field }, { status: 409 });
    }
    if (isUniqueConstraintError(cause)) {
      return NextResponse.json({ error: "Account already exists. Please sign in or reset your password.", code: "ACCOUNT_EXISTS" }, { status: 409 });
    }
    throw cause;
  }

  await logSecurityEvent("REGISTER", { userId: user.id, headers: req.headers });

  // Issue a single-use contact-verification challenge. When a sender is
  // configured the token travels only inside the emailed link; outside
  // production it is also returned for isolated testing. The account is never
  // reported as verified until /api/auth/verify-contact succeeds.
  const verification = await issueContactVerification(user.id, user.email, user.phone).catch(() => null);

  const { token } = await createSessionForUser(user, req.headers);
  const isProduction = process.env.NODE_ENV === "production";
  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    verificationRequired: Boolean(verification),
    ...(verification && !isProduction ? { devVerification: verification } : {}),
    ...(verification && isProduction
      ? {
        verificationDelivered: verification.delivered,
        verificationNote: verification.delivered
          ? "A confirmation email was sent. Your account remains unverified until the link is opened."
          : "No confirmation message was delivered. Your account exists but is unverified; use the support channel for recovery.",
      }
      : {}),
  });
  res.cookies.set(AUTH_COOKIE, token, cookieOptions());
  res.cookies.set("live_theme", user.theme || "system", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
