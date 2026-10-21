import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { env, isProd } from "./env";
import { toCurrentUserView, type CurrentUserView } from "./auth-user-view";
import { sha256, hashIp, clientIp } from "./security";
import crypto from "crypto";

const COOKIE_NAME = "live_token";
const ABSOLUTE_MS = 7 * 24 * 3600000;
const ADMIN_IDLE_MS = 4 * 3600000;

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }
export async function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

/** @deprecated Use createSessionForUser (revocable). Kept for tests only. */
export function signToken(payload: { id: string; email?: string | null; role: string; name: string }) {
  return jwt.sign(payload, env().JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, env().JWT_SECRET) as { id: string; email?: string; role: string; name: string; jti?: string };
  } catch { return null; }
}

export function cookieOptions(maxAgeMs = ABSOLUTE_MS) {
  return { httpOnly: true, path: "/", maxAge: Math.floor(maxAgeMs / 1000), sameSite: "lax" as const, secure: isProd() };
}

/** Create a server-side revocable session and return its JWT. */
export async function createSessionForUser(user: { id: string; email?: string | null; role: string; name: string }, headers?: Headers) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ABSOLUTE_MS);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(jti),
      userAgent: headers?.get("user-agent")?.slice(0, 200) || null,
      ipHash: headers ? hashIp(clientIp(headers)) : null,
      expiresAt,
    },
  });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, env().JWT_SECRET, { expiresIn: "7d", jwtid: jti });
  return { token, session };
}

export async function revokeSessionByToken(token: string | undefined) {
  if (!token) return;
  const decoded: any = (() => { try { return jwt.decode(token); } catch { return null; } })();
  if (!decoded?.jti) return;
  await prisma.session.updateMany({ where:{ tokenHash: sha256(String(decoded.jti)), revokedAt: null }, data:{ revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where:{ userId, revokedAt: null, ...(exceptSessionId ? { id:{ not: exceptSessionId } } : {}) },
    data:{ revokedAt: new Date() },
  });
}

/** Resolve { user, session } with full server-side checks. */
export async function getSessionContext() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded?.jti) return null; // pre-v3 stateless tokens are invalidated by upgrade
  const session = await prisma.session.findUnique({ where:{ tokenHash: sha256(decoded.jti) } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const user = await prisma.user.findUnique({ where:{ id: decoded.id } });
  if (!user || user.deletedAt || user.status === "SUSPENDED") return null;
  // Admin idle timeout
  if (user.isAdmin && Date.now() - session.lastSeenAt.getTime() > ADMIN_IDLE_MS) {
    await prisma.session.update({ where:{ id: session.id }, data:{ revokedAt: new Date() } });
    return null;
  }
  // Password changed after session creation → stale session
  if (user.passwordChangedAt && session.createdAt < user.passwordChangedAt) return null;
  // Touch sparingly (every 5 min) to limit writes
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60000) {
    prisma.session.update({ where:{ id: session.id }, data:{ lastSeenAt: new Date() } }).catch(() => {});
  }
  return { user, session };
}

export async function getCurrentUser(): Promise<CurrentUserView | null> {
  const ctx = await getSessionContext().catch(() => null);
  return ctx?.user ? toCurrentUserView(ctx.user) : null;
}

export async function requireUser(): Promise<CurrentUserView> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export const AUTH_COOKIE = COOKIE_NAME;
