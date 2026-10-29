/**
 * Client half of re-authentication.
 *
 * Sensitive endpoints answer `403` with `X-Reauth-Required: 1` when the session
 * is valid but has not proved the password recently. This helper turns that
 * into the obvious behaviour — ask once, prove it, retry — instead of surfacing
 * a confusing "forbidden" to someone who is, in fact, allowed.
 *
 * The retry happens exactly once. If it fails again the original response is
 * returned, so a caller can never cause a prompt loop.
 */

export const REAUTH_HEADER = "x-reauth-required";

/** True when a response is asking the user to prove their password. */
export function isReauthRequired(response: Response): boolean {
  return response.status === 403 && response.headers.get(REAUTH_HEADER) === "1";
}

type AskPassword = () => string | null;

function defaultAskPassword(): string | null {
  if (typeof window === "undefined") return null;
  // A native prompt is deliberate for now: it cannot be styled into something
  // that *looks* like the app asking for a password, which is exactly the shape
  // of a phishing overlay. Replace with a first-party dialog when one exists.
  return window.prompt("Confirm your password to continue");
}

/**
 * Perform a request, transparently stepping up if the server asks.
 *
 * The password is posted to `/api/auth/reauthenticate` and never stored; it
 * exists only for the duration of that call.
 */
export async function fetchWithStepUp(
  input: string,
  init: RequestInit = {},
  options: { askPassword?: AskPassword } = {},
): Promise<Response> {
  const first = await fetch(input, init);
  if (!isReauthRequired(first)) return first;

  const password = (options.askPassword ?? defaultAskPassword)();
  if (!password) return first;

  const proof = await fetch("/api/auth/reauthenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).catch(() => null);

  if (!proof?.ok) {
    // Surface the wrong-password message rather than the original 403, so the
    // user is not told they lack permission for something they do own.
    return proof ?? first;
  }

  // One retry with the same body. `init.body` may be a stream that has already
  // been consumed, so callers must pass a string body — every call site here
  // does (JSON).
  return fetch(input, init);
}
