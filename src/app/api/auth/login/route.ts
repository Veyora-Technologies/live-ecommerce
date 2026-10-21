import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, createSessionForUser, cookieOptions, AUTH_COOKIE } from "@/lib/auth";
import { randomBytes } from "node:crypto";
import { loginSchema, parseOr400 } from "@/lib/validate";
import { logSecurityEvent, raiseRisk } from "@/lib/security";
import { authenticator } from "otplib";
import { decryptSecret } from "@/lib/secret-vault";

const GENERIC = "Invalid email/phone or password";
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60000;
const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

async function compareDummyPassword(password: string) {
  await verifyPassword(password, await dummyPasswordHash);
}

export async function POST(req: NextRequest) {
  const parsed = parseOr400(loginSchema, await req.json().catch(() => ({})));
  if ("response" in parsed) return parsed.response;
  const { emailOrPhone, password, mfaCode } = parsed.data;

  const user = await prisma.user.findFirst({ where:{ OR:[{ email: emailOrPhone }, { phone: emailOrPhone }] } });
  // Match the password-hash work for unknown/deleted accounts to reduce timing-based enumeration.
  if (!user || !user.passwordHash || user.deletedAt) {
    await compareDummyPassword(password);
    await logSecurityEvent("LOGIN_FAIL", { headers: req.headers, metadata:{ reason:"no_account" } });
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const count = user.failedLoginCount + 1;
    const lock = count >= LOCK_AFTER;
    await prisma.user.update({ where:{ id: user.id }, data:{ failedLoginCount: count, ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_MS) } : {}) } });
    await logSecurityEvent(lock ? "LOCKOUT" : "LOGIN_FAIL", { userId: user.id, headers: req.headers });
    if (lock) await raiseRisk("LOGIN_LOCKOUT", "USER", user.id, "MEDIUM", "Account locked after repeated failed logins");
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Reveal account status only after the password is proved; unknown accounts
  // and invalid credentials above receive the same generic response.
  if (user.status === "SUSPENDED") return NextResponse.json({ error: "This account is suspended. Contact support." }, { status: 403 });
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "Too many failed attempts. Please try again later or reset your password." }, { status: 429 });
  }

  // MFA is mandatory whenever enabled. Unreadable encrypted secrets fail closed rather than bypassing MFA.
  if (user.mfaEnabled) {
    if (!user.mfaSecret) return NextResponse.json({ error: "MFA secret is unavailable; support-assisted recovery is required", mfaRequired: true }, { status: 503 });
    if (!mfaCode) return NextResponse.json({ error: "MFA code required", mfaRequired: true }, { status: 401 });
    let secret: string;
    try { secret = decryptSecret(user.mfaSecret); }
    catch {
      await logSecurityEvent("MFA_SECRET_DECRYPT_FAIL", { userId: user.id, headers: req.headers });
      return NextResponse.json({ error: "MFA secret storage needs migration or recovery; sign-in is blocked", mfaRequired: true }, { status: 503 });
    }
    const valid = authenticator.verify({ token: mfaCode, secret });
    if (!valid) {
      await logSecurityEvent("LOGIN_FAIL", { userId: user.id, headers: req.headers, metadata:{ reason:"mfa" } });
      return NextResponse.json({ error: "Invalid MFA code", mfaRequired: true }, { status: 401 });
    }
  }

  await prisma.user.update({ where:{ id: user.id }, data:{ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await logSecurityEvent("LOGIN_OK", { userId: user.id, headers: req.headers });
  // Use authoritative ownership/membership relations, not the account's display role,
  // to choose a useful default landing page. This hint is best-effort so it cannot
  // prevent an otherwise valid login if the merchant tables are temporarily unavailable.
  let hasMerchantAccess = false;
  if (!user.isAdmin) {
    try {
      hasMerchantAccess = !!(await prisma.merchant.findFirst({
        where: { OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, status: "ACTIVE" } } }] },
        select: { id: true },
      }));
    } catch {
      hasMerchantAccess = false;
    }
  }
  const landingPath = user.isAdmin ? "/admin" : hasMerchantAccess ? "/merchant" : "/";
  const { token } = await createSessionForUser(user, req.headers);
  const res = NextResponse.json({
    ok: true,
    landingPath,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isAdmin: user.isAdmin },
    ...(user.isAdmin && !user.mfaEnabled ? { warning: "Enable two-factor authentication in Profile → Account security to strengthen administrator sign-in." } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
  res.cookies.set(AUTH_COOKIE, token, cookieOptions());
  res.cookies.set("live_theme", user.theme || "system", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
