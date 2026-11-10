import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionContext } from "@/lib/auth";
import { isReauthFresh, reauthRequired } from "@/lib/reauth";
import { logSecurityEvent } from "@/lib/security";

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessions = await prisma.session.findMany({
    where:{ userId: ctx.user.id, revokedAt: null, expiresAt:{ gt: new Date() } },
    orderBy:{ lastSeenAt: "desc" }, take: 20,
  });
  return NextResponse.json({
    currentSessionId: ctx.session.id,
    sessions: sessions.map(s => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, userAgent: s.userAgent, current: s.id === ctx.session.id })),
  });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Revoking every other session is the action an attacker takes to lock the
  // real owner out of their own account, so it must not be reachable with a
  // cookie alone.
  if (!isReauthFresh(ctx.session)) return reauthRequired();
  const { sessionId, all } = await req.json().catch(() => ({}));
  if (all) {
    await prisma.session.updateMany({ where:{ userId: ctx.user.id, id:{ not: ctx.session.id }, revokedAt: null }, data:{ revokedAt: new Date() } });
  } else if (sessionId) {
    await prisma.session.updateMany({ where:{ id: String(sessionId), userId: ctx.user.id }, data:{ revokedAt: new Date() } });
  } else return NextResponse.json({ error: "sessionId or all required" }, { status: 400 });
  await logSecurityEvent("SESSION_REVOKED", { userId: ctx.user.id, headers: req.headers });
  return NextResponse.json({ ok: true });
}
