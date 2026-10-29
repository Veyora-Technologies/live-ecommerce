import { NextResponse } from "next/server";
import { prisma } from "./db";
import { ReauthRequiredError, UnauthorizedError } from "./api-errors";
import { getSessionContext, verifyPassword } from "./auth";

/**
 * Re-authentication ("step-up") for sensitive actions.
 *
 * ## The problem
 *
 * A session cookie lives for 7 days. If someone walks up to an unlocked laptop,
 * or a token is replayed from a stolen backup, that cookie alone is enough to
 * change the password, disable MFA, revoke the real owner's other sessions, or
 * mint an API key. The legitimate user's *presence* was never re-checked.
 *
 * ## The rule
 *
 * Actions that can lock the owner out or grant durable access require the
 * password to have been proved recently — within `REAUTH_WINDOW_MS` — on this
 * specific session. Signing in counts as proof, so the normal flow never sees a
 * prompt; only a stale session does.
 *
 * ## Why the timestamp lives on the session, not the user
 *
 * Proving a password on a phone must not authorise a sensitive change from a
 * laptop session that has been idle for two days. Scoping the freshness to the
 * session means each device must step up for itself.
 *
 * ## Why a window rather than a single-use token
 *
 * A short window avoids interrupting a genuine burst of settings changes, while
 * still bounding how long a stolen cookie remains useful for them. 15 minutes
 * is deliberate: long enough to finish a task, short enough that an unattended
 * machine is not a standing grant.
 */

export { REAUTH_WINDOW_MS, isReauthFresh, secondsUntilReauthExpiry } from "./reauth-core";
import { REAUTH_WINDOW_MS, isReauthFresh } from "./reauth-core";

/**
 * Require a valid session whose password proof is still fresh.
 *
 * Returns the context so the caller can use `session.id` / `user.id` without a
 * second lookup, mirroring `getSessionContext()`.
 */
export async function requireRecentAuth(options: { windowMs?: number } = {}) {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthorizedError();
  if (!isReauthFresh(ctx.session, new Date(), options.windowMs ?? REAUTH_WINDOW_MS)) {
    throw new ReauthRequiredError();
  }
  return ctx;
}

/**
 * Record a successful password proof on the current session.
 *
 * Called only after `verifyPassword` has actually succeeded — never from a
 * "remember me" path or an OAuth callback, because those prove identity at sign
 * in, not presence now.
 */
export async function markReauthenticated(sessionId: string): Promise<Date> {
  const at = new Date();
  await prisma.session.update({ where: { id: sessionId }, data: { reauthenticatedAt: at } });
  return at;
}

/**
 * Verify the caller's password and, on success, stamp the session.
 *
 * Returns `null` for a wrong password. Callers must treat `null` as a failed
 * attempt and let `logSecurityEvent` record it; this function deliberately does
 * not throw so the caller can choose the response shape (and so a brute-force
 * attempt is visible in the audit trail rather than silently 401'd).
 */
export async function provePasswordAndStamp(
  userId: string,
  sessionId: string,
  password: string,
): Promise<Date | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return markReauthenticated(sessionId);
}

/**
 * Standard `403 REAUTH_REQUIRED` response.
 *
 * Exported so routes that already return their own `NextResponse` do not need
 * try/catch around `requireRecentAuth`. The `X-Reauth-Required` header lets a
 * client distinguish "you lack permission" from "prove it's you, then retry"
 * without parsing prose.
 */
export function reauthRequired(message = "Confirm your password to continue."): NextResponse {
  return NextResponse.json(
    { error: message, code: "REAUTH_REQUIRED" },
    { status: 403, headers: { "Cache-Control": "private, no-store", "X-Reauth-Required": "1" } },
  );
}
