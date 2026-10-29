/**
 * Transactional email delivery.
 *
 * The provider is Resend's HTTP API, called with `fetch` so no SDK or extra
 * dependency is required. Delivery is **fail-closed**: when `RESEND_API_KEY` or
 * `EMAIL_FROM` is missing, `sendEmail` reports NOT_CONFIGURED and callers must
 * not claim that a message was sent.
 *
 * Rules enforced here:
 *   - never log or return message bodies, tokens, or the API key
 *   - bounded timeout so a slow provider cannot stall a request
 *   - no retries in-request (the caller decides; a retry loop in a route handler
 *     would amplify load during a provider outage)
 */

import { getPublicBaseUrl } from "./public-url";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

export type EmailDelivery =
  | { delivered: true; providerId: string | null }
  | { delivered: false; reason: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT" };

export type EmailInput = {
  to: string;
  subject: string;
  text: string;
  /** Optional provider idempotency key (e.g. a reset-challenge id). */
  idempotencyKey?: string;
};

/** True only when a sender address and API key are both present. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/**
 * Absolute base URL for links inside emails. Delegates to `getPublicBaseUrl`,
 * which requires an explicit public HTTPS origin and rejects localhost, `.local`
 * and sandbox preview hosts — a production email can never link to a dev server.
 */
export function emailLinkBase(): string | null {
  return getPublicBaseUrl();
}

export async function sendEmail(input: EmailInput): Promise<EmailDelivery> {
  if (!emailConfigured()) return { delivered: false, reason: "NOT_CONFIGURED" };
  if (!input.to || input.to.length > 254 || !input.to.includes("@")) return { delivered: false, reason: "PROVIDER_ERROR" };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey.slice(0, 255);

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject.slice(0, 200),
        text: input.text.slice(0, 20000),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { delivered: false, reason: "PROVIDER_ERROR" };
    const payload = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { delivered: true, providerId: typeof payload?.id === "string" ? payload.id : null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { delivered: false, reason: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "PROVIDER_ERROR" };
  }
}
