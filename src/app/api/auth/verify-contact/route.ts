import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logSecurityEvent, randomToken, sha256 } from "@/lib/security";

const noStore = { headers: { "Cache-Control": "private, no-store" } };
const confirmSchema = z.object({ token: z.string().trim().min(10).max(200) }).strict();

/**
 * Contact verification.
 *
 * POST            — issue a fresh single-use verification challenge for the
 *                   signed-in account. Returns the raw token only outside
 *                   production (no sender adapter is configured in this build).
 * PUT             — consume a token and mark the matching contact verified.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  const channel = account.email && !account.emailVerifiedAt ? "EMAIL" : account.phone && !account.phoneVerifiedAt ? "PHONE" : null;
  if (!channel) {
    return NextResponse.json({ ok: true, alreadyVerified: true, emailVerified: Boolean(account.emailVerifiedAt), phoneVerified: Boolean(account.phoneVerifiedAt) }, noStore);
  }

  await prisma.tokenChallenge.updateMany({ where: { userId: user.id, type: "VERIFY_CONTACT", usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await prisma.tokenChallenge.create({
    data: { userId: user.id, type: "VERIFY_CONTACT", tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 3600000) },
  });
  await logSecurityEvent("CONTACT_VERIFICATION_ISSUED", { userId: user.id, headers: req.headers, metadata: { channel } });

  const isProduction = process.env.NODE_ENV === "production";
  return NextResponse.json({
    ok: true,
    channel,
    expiresInHours: 24,
    ...(isProduction
      ? { delivered: false, note: "No email/SMS sender is configured in this release, so no message was sent. Use your verified support channel for account recovery." }
      : { delivered: false, devVerificationToken: raw, note: "Development only — no message was sent. Use this token with PUT /api/auth/verify-contact." }),
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

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, phone: true } });
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  const now = new Date();
  await prisma.$transaction([
    prisma.tokenChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        ...(account.email ? { emailVerifiedAt: now } : {}),
        ...(account.phone ? { phoneVerifiedAt: now } : {}),
      },
    }),
  ]);
  await logSecurityEvent("CONTACT_VERIFIED", { userId: user.id, headers: req.headers });
  return NextResponse.json({ ok: true, emailVerified: Boolean(account.email), phoneVerified: Boolean(account.phone) }, noStore);
}
