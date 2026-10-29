import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { logSecurityEvent } from "@/lib/security";
import { provePasswordAndStamp, REAUTH_WINDOW_MS, secondsUntilReauthExpiry } from "@/lib/reauth";
import { withApiHandler } from "@/lib/api-handler";

/**
 * POST /api/auth/reauthenticate
 *
 * Step-up endpoint. The client calls this when a sensitive action returned
 * `403 REAUTH_REQUIRED`, prompts for the password, and retries the original
 * action once this succeeds.
 *
 * This deliberately does **not** rotate the session or the JWT. The caller is
 * already authenticated; the missing ingredient is proof of presence. Rotating
 * here would sign the user out of nothing useful while making the retry logic
 * meaningfully harder to get right.
 *
 * Rate limiting is inherited from `src/proxy.ts`, which gives every
 * `/api/auth/*` route its own strict bucket, so this endpoint cannot be used as
 * an unthrottled password oracle.
 */
const schema = z.object({
  password: z.string().min(1).max(200),
});

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, ...noStore });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password is required.", code: "INVALID_REQUEST" },
      { status: 400, ...noStore },
    );
  }

  const stampedAt = await provePasswordAndStamp(ctx.user.id, ctx.session.id, parsed.data.password);

  if (!stampedAt) {
    // Recorded as a security event: repeated failures here are a strong signal
    // that a stolen cookie is being probed for the password behind it.
    await logSecurityEvent("REAUTH_FAILED", {
      userId: ctx.user.id,
      headers: req.headers,
      metadata: { sessionId: ctx.session.id },
    });
    return NextResponse.json(
      { error: "That password is not correct.", code: "INVALID_CREDENTIALS" },
      { status: 403, ...noStore },
    );
  }

  await logSecurityEvent("REAUTH_SUCCEEDED", {
    userId: ctx.user.id,
    headers: req.headers,
    metadata: { sessionId: ctx.session.id },
  });

  return NextResponse.json(
    {
      ok: true,
      reauthenticatedAt: stampedAt.toISOString(),
      expiresInSeconds: secondsUntilReauthExpiry({ reauthenticatedAt: stampedAt }),
      windowSeconds: Math.floor(REAUTH_WINDOW_MS / 1000),
    },
    noStore,
  );
}, { name: "auth.reauthenticate" });
