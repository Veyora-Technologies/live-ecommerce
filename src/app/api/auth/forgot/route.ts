import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomToken, sha256, logSecurityEvent } from "@/lib/security";
import { emailConfigured, emailLinkBase, sendEmail } from "@/lib/email";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };
const GENERIC = { ok: true, message: "If an account exists, reset instructions have been sent." };
const TTL_MS = 30 * 60000;

/**
 * Password-reset request.
 *
 * Delivery is real only when a sender is configured (`RESEND_API_KEY` +
 * `EMAIL_FROM` + an absolute HTTPS origin for the link). When those are absent
 * the endpoint refuses with 503 rather than pretending to send mail or creating
 * a token nobody can receive.
 *
 * Responses are identical for known and unknown accounts so the endpoint cannot
 * be used to enumerate users. Per-user delivery failures are recorded server
 * side and never surfaced.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const emailOrPhone = typeof body?.emailOrPhone === "string" ? body.emailOrPhone.trim() : "";
  const isProduction = process.env.NODE_ENV === "production";
  const base = emailLinkBase();

  if (isProduction) {
    if (!emailConfigured() || !base) {
      await logSecurityEvent("PASSWORD_RESET_DELIVERY_UNAVAILABLE", { headers: req.headers });
      return NextResponse.json({
        ok: false,
        code: "PASSWORD_RESET_DELIVERY_UNAVAILABLE",
        error: "Password reset by email is unavailable. No email was sent. Use Furnivo's verified support channel for account recovery.",
      }, { status: 503, headers: PRIVATE_HEADERS });
    }
    if (!emailOrPhone || emailOrPhone.length > 120) return NextResponse.json(GENERIC, { headers: PRIVATE_HEADERS });

    const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } });
    if (user && !user.deletedAt && user.email) {
      await prisma.tokenChallenge.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
      const raw = randomToken(32);
      const challenge = await prisma.tokenChallenge.create({
        data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL_MS) },
      });
      const link = `${base}/auth/reset?token=${encodeURIComponent(raw)}`;
      const delivery = await sendEmail({
        to: user.email,
        subject: "Reset your Furnivo password",
        text: [
          "Someone requested a password reset for your Furnivo account.",
          "",
          `Open this link within 30 minutes to choose a new password: ${link}`,
          "",
          "If you did not request this, you can ignore this message. Your password will not change.",
          "Furnivo will never ask you for your password or a reset code by email.",
        ].join("\n"),
        idempotencyKey: challenge.id,
      });
      if (!delivery.delivered) {
        await logSecurityEvent("PASSWORD_RESET_DELIVERY_FAILED", { userId: user.id, headers: req.headers, metadata: { reason: delivery.reason } });
        // Burn the unusable token so a failed delivery cannot leave a live
        // challenge behind that was never sent to the account owner.
        await prisma.tokenChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
      } else {
        await logSecurityEvent("PASSWORD_RESET_REQ", { userId: user.id, headers: req.headers });
      }
    }
    return NextResponse.json(GENERIC, { headers: PRIVATE_HEADERS });
  }

  // Development / test: no sender is assumed. The token is returned so the reset
  // flow can be exercised without an email provider.
  if (!emailOrPhone || emailOrPhone.length > 120) return NextResponse.json(GENERIC, { headers: PRIVATE_HEADERS });
  const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } });
  if (!user || user.deletedAt) return NextResponse.json(GENERIC, { headers: PRIVATE_HEADERS });

  await prisma.tokenChallenge.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await prisma.tokenChallenge.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  await logSecurityEvent("PASSWORD_RESET_REQ", { userId: user.id, headers: req.headers });
  await prisma.notification.create({
    data: { recipientId: user.id, type: "SECURITY", title: "Password reset requested", body: "A password reset was requested for your account. If this wasn't you, secure your account." },
  }).catch(() => {});

  return NextResponse.json({
    ...GENERIC,
    devResetToken: raw,
    devNote: "Development only — this token is not an email and must never be used for production recovery.",
  }, { headers: PRIVATE_HEADERS });
}
