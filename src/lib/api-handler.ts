import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { toErrorResponse, describeError, isApiError } from "./api-errors";
import { requestIdFrom, REQUEST_ID_HEADER } from "./request-id";

/**
 * The request-level error boundary.
 *
 * `src/app/error.tsx` catches failures while rendering a page. This is the
 * server-side equivalent for API routes: it guarantees that an unhandled throw
 * becomes a JSON error response with a correlation id, instead of Next's HTML
 * "Application error" page (which an `fetch()` client cannot parse) or a body
 * that leaks a stack trace.
 *
 * Usage:
 *
 *   export const POST = withApiHandler(async (req) => { ... });
 *
 * Handlers that already return their own error responses are unaffected — the
 * wrapper only observes what escapes them.
 */

type MaybePromise<T> = T | Promise<T>;

/** Structural type so this module does not depend on Prisma or route internals. */
export type ApiRouteHandler<C = unknown> = (req: NextRequest, context: C) => MaybePromise<Response>;

export type ApiHandlerOptions = {
  /** Short label used in logs, e.g. "merchant.products.create". */
  name?: string;
};

/**
 * Remove anything secret-shaped from a log line.
 *
 * Logging a failure is useful; logging the credential that caused it is a
 * second incident. This scrubber is intentionally aggressive — it is better to
 * over-redact a stack trace than to write a live key into a log aggregator.
 */
export function scrubSecrets(input: string): string {
  return input
    // Bearer/JWT-shaped tokens: three dot-separated base64url segments.
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-jwt]")
    // Well-known provider key prefixes.
    .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9_-]{6,}/g, "[redacted-key]")
    // Provider keys may themselves contain "_" (re_live_…, sk_live_…), so the
    // tail allows underscores; a stricter class silently missed every such key.
    .replace(/\bre_[A-Za-z0-9_-]{10,}/g, "[redacted-key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted-key]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]")
    // scheme://user:password@host connection strings.
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    // key=value / key: value where the key name says it is a credential.
    .replace(/\b([A-Za-z0-9_]*(?:secret|password|passwd|token|apikey|api_key|private_key|credential)[A-Za-z0-9_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1=[redacted]")
    // Long opaque blobs (32+ hex / base64url) — salts, hashes, generated keys.
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]");
}

/** Log-safe path: the query string can carry tokens, so it is dropped. */
function safePath(req: NextRequest): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "<unparseable-url>";
  }
}

/**
 * Wrap a route handler so nothing escapes unhandled.
 *
 * The wrapper does not swallow programming errors: it still writes them to the
 * server log (scrubbed), which is what makes the 500 debuggable. What it
 * refuses to do is return them to the caller.
 */
export function withApiHandler<C = unknown>(
  handler: ApiRouteHandler<C>,
  options: ApiHandlerOptions = {},
): ApiRouteHandler<C> {
  return async (req: NextRequest, context: C): Promise<Response> => {
    const requestId = requestIdFrom(req.headers);
    try {
      return await handler(req, context);
    } catch (error) {
      const { name, message, stack } = describeError(error);

      // Known, deliberate failures are expected traffic — a wrong password is
      // not a bug. Log them at one line without the stack.
      if (isApiError(error)) {
        console.warn(
          scrubSecrets(
            `[api] ${name} ${error.code} ${req.method} ${safePath(req)} requestId=${requestId}${
              options.name ? ` handler=${options.name}` : ""
            }`,
          ),
        );
      } else {
        console.error(
          scrubSecrets(
            `[api] unhandled ${name} ${req.method} ${safePath(req)} requestId=${requestId}${
              options.name ? ` handler=${options.name}` : ""
            }\n${message}\n${stack ?? ""}`,
          ),
        );
      }

      return toErrorResponse(error, requestId);
    }
  };
}

/**
 * Stamp the correlation id onto a successful response so support can match a
 * user's screenshot to a server log line even when nothing failed.
 */
export function withRequestId(response: Response, requestId: string): Response {
  try {
    if (!response.headers.has(REQUEST_ID_HEADER) && response instanceof NextResponse) {
      response.headers.set(REQUEST_ID_HEADER, requestId);
    }
  } catch {
    // Immutable headers (redirects, proxied responses) are left untouched.
  }
  return response;
}
