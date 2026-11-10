/**
 * Step-up freshness rules (pure).
 *
 * No database, no Next.js, no crypto — only the arithmetic that decides whether
 * a password proof is still recent enough to authorise a sensitive action.
 * Extracted so it can be tested directly; `reauth.ts` re-exports it alongside
 * the server-side helpers.
 */

/** How long a password proof stays valid for sensitive actions. */
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

/** A session is "fresh" when it proved a password inside the window. */
export function isReauthFresh(
  session: { reauthenticatedAt?: Date | null },
  now: Date = new Date(),
  windowMs: number = REAUTH_WINDOW_MS,
): boolean {
  const at = session.reauthenticatedAt;
  if (!at) return false;
  const age = now.getTime() - new Date(at).getTime();
  // A clock skew that puts the proof in the future is treated as stale rather
  // than trusted: an attacker who can move a clock forward must not win.
  return age >= 0 && age <= windowMs;
}

/** Seconds until another step-up is needed, for client-side prompting. */
export function secondsUntilReauthExpiry(
  session: { reauthenticatedAt?: Date | null },
  now: Date = new Date(),
  windowMs: number = REAUTH_WINDOW_MS,
): number {
  if (!isReauthFresh(session, now, windowMs)) return 0;
  const at = new Date(session.reauthenticatedAt as Date).getTime();
  return Math.max(0, Math.ceil((at + windowMs - now.getTime()) / 1000));
}
