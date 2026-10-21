import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomToken, sha256, logSecurityEvent } from "@/lib/security";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };
const DEV_GENERIC = { ok: true, message: "If an account exists, reset instructions have been prepared." };

/**
 * Password-reset request.
 *
 * Production email delivery is intentionally unavailable until an actual sender adapter,
 * verified sender/domain, and delivery-status handling are configured. Do not report success
 * or create an unusable reset token when no message can be delivered. Development keeps the
 * token-return flow for isolated local testing only.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (process.env.NODE_ENV === "production") {
    await logSecurityEvent("PASSWORD_RESET_DELIVERY_UNAVAILABLE", { headers: req.headers });
    return NextResponse.json({
      ok: false,
      code: "PASSWORD_RESET_DELIVERY_UNAVAILABLE",
      error: "Password reset by email is unavailable. No email was sent. Use Live's verified support channel for account recovery.",
    }, { status: 503, headers: PRIVATE_HEADERS });
  }

  const emailOrPhone = typeof body?.emailOrPhone === "string" ? body.emailOrPhone.trim() : "";
  if (!emailOrPhone || emailOrPhone.length > 120) {
    return NextResponse.json(DEV_GENERIC, { headers: PRIVATE_HEADERS });
  }
  const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } });
  if (!user || user.deletedAt) return NextResponse.json(DEV_GENERIC, { headers: PRIVATE_HEADERS });

  // Invalidate previous unused reset tokens.
  await prisma.tokenChallenge.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await prisma.tokenChallenge.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60000) },
  });
  await logSecurityEvent("PASSWORD_RESET_REQ", { userId: user.id, headers: req.headers });
  await prisma.notification.create({
    data: { recipientId: user.id, type: "SECURITY", title: "Password reset requested", body: "A password reset was requested for your account. If this wasn't you, secure your account." },
  }).catch(() => {});

  return NextResponse.json({
    ...DEV_GENERIC,
    devResetToken: raw,
    devNote: "Development only — this token is not an email and must never be used for production recovery.",
  }, { headers: PRIVATE_HEADERS });
}
