import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  AUTH_COOKIE,
  cookieOptions,
  createSessionForUser,
  getSessionContext,
  hashPassword,
  revokeAllSessions,
  verifyPassword,
} from "@/lib/auth";
import { logSecurityEvent } from "@/lib/security";
import { z } from "zod";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });
const noStore = { headers: { "Cache-Control": "private, no-store" } };

/**
 * Change password. Requires the current password, then revokes every existing
 * session — including this one — and issues a fresh session.
 *
 * The previous implementation rewrote the current session's `createdAt` to
 * outrun the `passwordChangedAt` staleness check, which was fragile and left a
 * session created before the credential change alive. Rotating the session is
 * both simpler and stronger: every pre-change session (including any the
 * attacker may hold) stops working, and the caller keeps working because the
 * response carries a new cookie.
 */
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "New password must be at least 10 characters." }, { status: 400, ...noStore });
  const user = await prisma.user.findUnique({ where: { id: ctx.user.id } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    await logSecurityEvent("PASSWORD_CHANGED", { userId: user?.id, headers: req.headers, metadata: { result: "reauth_failed" } });
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403, ...noStore });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() },
  });
  await revokeAllSessions(user.id);

  const { token } = await createSessionForUser(user, req.headers);
  await logSecurityEvent("PASSWORD_CHANGED", { userId: user.id, headers: req.headers, metadata: { via: "change", sessionsRevoked: "all" } });

  const res = NextResponse.json({ ok: true, message: "Password changed. All other devices were signed out." }, noStore);
  res.cookies.set(AUTH_COOKIE, token, cookieOptions());
  return res;
}
