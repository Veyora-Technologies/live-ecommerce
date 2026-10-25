import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionContext, verifyPassword } from "@/lib/auth";
import { logSecurityEvent } from "@/lib/security";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret } from "@/lib/secret-vault";

/** TOTP MFA via otplib (maintained library). Enable/disable both require password reauth + valid code. */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ mfaEnabled: ctx.user.mfaEnabled, requiredForAdmin: ctx.user.isAdmin });
}

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const user = await prisma.user.findUnique({ where:{ id: ctx.user.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (body.action === "begin") {
    if (user.mfaEnabled) return NextResponse.json({ error: "MFA is already enabled" }, { status: 400 });
    const currentPassword = body.currentPassword || body.password;
    if (!currentPassword || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Current password required" }, { status: 403 });
    }
    const secret = authenticator.generateSecret();
    let encryptedSecret: string;
    try { encryptedSecret = encryptSecret(secret); }
    catch { return NextResponse.json({ error: "Encrypted MFA secret storage is not configured" }, { status: 503 }); }
    // Store the pending TOTP secret only in authenticated encrypted form; mfaEnabled stays false until verified.
    await prisma.user.update({ where:{ id: user.id }, data:{ mfaSecret: encryptedSecret } });
    const otpauth = authenticator.keyuri(user.email || user.phone || user.id, "Furnivo", secret);
    // QR is generated locally — the secret must never be sent to a third-party QR service.
    const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 200 }).catch(() => null);
    return NextResponse.json({ secret, otpauth, qrDataUrl, note: "Scan with your authenticator app, then confirm with a 6-digit code. Losing the app without disabling MFA first requires support identity verification." });
  }

  if (body.action === "confirm") {
    if (!user.mfaSecret || !body.code) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    let secret: string;
    try { secret = decryptSecret(user.mfaSecret); }
    catch { return NextResponse.json({ error: "MFA secret storage needs migration or re-enrolment" }, { status: 503 }); }
    if (!authenticator.verify({ token: String(body.code), secret })) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    await prisma.user.update({ where:{ id: user.id }, data:{ mfaEnabled: true } });
    await logSecurityEvent("MFA_ENABLED", { userId: user.id, headers: req.headers });
    return NextResponse.json({ ok: true, mfaEnabled: true });
  }

  if (body.action === "disable") {
    const currentPassword = body.currentPassword || body.password;
    if (!currentPassword || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Current password required" }, { status: 403 });
    }
    if (!user.mfaSecret || !body.code) return NextResponse.json({ error: "Valid MFA code required to disable" }, { status: 400 });
    let secret: string;
    try { secret = decryptSecret(user.mfaSecret); }
    catch { return NextResponse.json({ error: "MFA secret storage needs migration or support-assisted recovery" }, { status: 503 }); }
    if (!authenticator.verify({ token: String(body.code), secret })) return NextResponse.json({ error: "Valid MFA code required to disable" }, { status: 400 });
    await prisma.user.update({ where:{ id: user.id }, data:{ mfaEnabled: false, mfaSecret: null } });
    await logSecurityEvent("MFA_DISABLED", { userId: user.id, headers: req.headers });
    return NextResponse.json({ ok: true, mfaEnabled: false });
  }

  return NextResponse.json({ error: "action must be begin|confirm|disable" }, { status: 400 });
}
