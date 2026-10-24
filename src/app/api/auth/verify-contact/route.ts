import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logSecurityEvent, randomToken, sha256 } from "@/lib/security";
import { emailConfigured, emailLinkBase, sendEmail } from "@/lib/email";

const noStore = { headers: { "Cache-Control": "private, no-store" } };
const confirmSchema = z.object({ token: z.string().trim().min(10).max(200) }).strict();

/**
 * Contact verification.
 *
 * Only email can be verified: this build has no SMS provider, so a phone
 * number is never marked verified — that would be a claim nothing supports.
 *
 * POST — issue a fresh single-use verification challenge for the signed-in
 *        account and email it when a sender is configured. The raw token is
 *        returned only outside production, for isolated testing.
 * PUT  — consume a token and mark the account's email verified.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  if (!account.email) {
    return NextResponse.json({
      ok: false,
      code: "NO_VERIFIABLE_CONTACT",
      channel: null,
      delivered: false,
      error: "This account has no email address. SMS verification is not supported in this deployment, so no contact can be verified here.",
    }, { status: 409, ...noStore });
  }
  if (account.emailVerifiedAt) {
    return NextResponse.json({
      ok: true,
      alreadyVerified: true,
      channel: null,
      delivered: false,
      emailVerified: true,
      phoneVerified: Boolean(account.phoneVerifiedAt),
      note: "This email is already verified. Phone verification is not supported in this deployment.",
    }, noStore);
  }
  const channel = "EMAIL";

  await prisma.tokenChallenge.updateMany({ where: { userId: user.id, type: "VERIFY_CONTACT", usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await prisma.tokenChallenge.create({
    data: { userId: user.id, type: "VERIFY_CONTACT", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 3600000) },
  });
  await logSecurityEvent("CONTACT_VERIFICATION_ISSUED", { userId: user.id, headers: req.headers, metadata: { channel } });

  let delivered = false;
  if (emailConfigured() && emailLinkBase()) {
    const result = await sendEmail({
      to: account.email,
      subject: "Confirm your Live email address",
      text: [
        "Confirm the email address on your Live account.",
        "",
        `Open this link within 24 hours: ${emailLinkBase()}/auth/verify?token=${encodeURIComponent(raw)}`,
        "",
        "If you did not request this, ignore this message.",
      ].join("\n"),
      idempotencyKey: `verify:${user.id}:${Date.now()}`,
    });
    delivered = result.delivered;
  }

  const isProduction = process.env.NODE_ENV === "production";
  return NextResponse.json({
    ok: true,
    channel,
    expiresInHours: 24,
    delivered,
    ...(isProduction
      ? {
        note: delivered
          ? "A confirmation email was sent. Your account stays unverified until the link is opened."
          : "No message was sent. Email delivery is not configured for this deployment; use the support channel for account recovery.",
      }
      : { devVerificationToken: raw, note: "Development only — no message is sent unless RESEND_API_KEY and EMAIL_FROM are configured. You can also use this token with PUT /api/auth/verify-contact." }),
  }, noStore);
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A verification token is required." }, { status: 400, ...noStore });

  const challenge = await prisma.tokenChallenge.findFirst({
    where: { tokenHash: sha256(parsed.data.token), userId: user.id, type: "VERIFY_CONTACT" },
  });
  if (!challenge || challenge.usedAt || challenge.expiresAt < new Date()) {
    return NextResponse.json({ error: "This verification link is invalid or expired. Request a new one." }, { status: 400, ...noStore });
  }

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, phoneVerifiedAt: true } });
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  if (!account.email) {
    // An email challenge cannot exist for an account without an email, but a
    // stale token must never be redeemed into a phone verification.
    return NextResponse.json({ error: "This account has no email address to verify." }, { status: 409, ...noStore });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.tokenChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } }),
    prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } }),
  ]);
  await logSecurityEvent("CONTACT_VERIFIED", { userId: user.id, headers: req.headers });
  return NextResponse.json({ ok: true, emailVerified: true, phoneVerified: Boolean(account.phoneVerifiedAt) }, noStore);
}
