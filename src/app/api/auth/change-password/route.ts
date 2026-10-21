import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionContext, verifyPassword, hashPassword, revokeAllSessions } from "@/lib/auth";
import { logSecurityEvent } from "@/lib/security";
import { z } from "zod";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });

/** Reauthentication required: current password must be proven. Other sessions revoked; current kept. */
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "New password must be at least 10 characters." }, { status: 400 });
  const user = await prisma.user.findUnique({ where:{ id: ctx.user.id } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    await logSecurityEvent("PASSWORD_CHANGED", { userId: user?.id, headers: req.headers, metadata:{ result:"reauth_failed" } });
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }
  // NOTE: passwordChangedAt would invalidate the current session too, so we bump
  // the current session's createdAt marker by refreshing lastSeen + keeping it:
  // simpler & safe: revoke others, then update passwordChangedAt to just before now
  // and move current session createdAt forward.
  await prisma.user.update({ where:{ id: user.id }, data:{ passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() } });
  await revokeAllSessions(user.id, ctx.session.id);
  await prisma.session.update({ where:{ id: ctx.session.id }, data:{ createdAt: new Date(), lastSeenAt: new Date() } });
  await logSecurityEvent("PASSWORD_CHANGED", { userId: user.id, headers: req.headers, metadata:{ via:"change" } });
  return NextResponse.json({ ok: true, message: "Password changed. Other devices were signed out." });
}
