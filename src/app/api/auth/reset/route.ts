import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, revokeAllSessions } from "@/lib/auth";
import { sha256, logSecurityEvent } from "@/lib/security";
import { resetSchema } from "@/lib/validate";

const schema = resetSchema;

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request. Password must be at least 10 characters." }, { status: 400 });
  const challenge = await prisma.tokenChallenge.findUnique({ where:{ tokenHash: sha256(parsed.data.token) } });
  if (!challenge || challenge.type !== "PASSWORD_RESET" || challenge.usedAt || challenge.expiresAt < new Date()) {
    return NextResponse.json({ error: "This reset link is invalid or expired. Request a new one." }, { status: 400 });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.tokenChallenge.update({ where:{ id: challenge.id }, data:{ usedAt: new Date() } }),
    prisma.user.update({ where:{ id: challenge.userId }, data:{ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } }),
  ]);
  await revokeAllSessions(challenge.userId); // recovery revokes every session
  await logSecurityEvent("PASSWORD_CHANGED", { userId: challenge.userId, headers: req.headers, metadata:{ via:"reset" } });
  return NextResponse.json({ ok: true, message: "Password updated. Please sign in again on all devices." });
}
