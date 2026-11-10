import { NextResponse } from "next/server";
import { requestIdFrom, REQUEST_ID_HEADER } from "./request-id";

/**
 * Typed API failures.
 *
 * The rule this module exists to enforce: **an exception is not a response**.
 * Only errors that were deliberately thrown as an `ApiError` may carry a
 * message to the client. Anything else — a Prisma failure, a TypeError, an
 * upstream fetch rejection — is treated as internal and serialised as a
 * generic message plus a correlation id.
 *
 * That distinction is what stops environment values, SQL fragments, connection
 * strings and stack frames from reaching a browser or an API consumer. It is
 * enforced in `toErrorResponse` and covered by
 * `tests/unit/api-errors.test.ts`, which feeds it real secrets and asserts none
 * of them appear in the body.
 */

export type ApiErrorOptions = {
  /** Structured, non-sensitive detail safe to render (e.g. field names). */
  details?: Record<string, unknown>;
  /** Original error, kept for server-side logging only. */
  cause?: unknown;
  /** Extra response headers (e.g. `WWW-Authenticate`, `Retry-After`). */
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, publicMessage: string, options: ApiErrorOptions = {}) {
    super(publicMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.details = options.details;
    this.headers = options.headers;
  }
}

/** 400 — the caller sent something we can describe precisely. */
export class ValidationError extends ApiError {
  constructor(message = "That request could not be processed.", details?: Record<string, unknown>) {
    super(400, "INVALID_REQUEST", message, { details });
    this.name = "ValidationError";
  }
}

/** 401 — no valid, active session. */
export class UnauthorizedError extends ApiError {
  constructor(message = "Please sign in to continue.") {
    super(401, "UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

/** 403 — authenticated, but not allowed to do this. */
export class ForbiddenError extends ApiError {
  constructor(message = "You do not have access to this resource.") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

/**
 * 403 — the session is valid but too old for this action. The client is
 * expected to prompt for the password again rather than sign the user out.
 */
export class ReauthRequiredError extends ApiError {
  constructor(message = "Please confirm your password to continue.") {
    super(403, "REAUTH_REQUIRED", message, { headers: { "X-Reauth-Required": "1" } });
    this.name = "ReauthRequiredError";
  }
}

/** 404 — deliberately indistinguishable from "not yours". */
export class NotFoundError extends ApiError {
  constructor(message = "That item could not be found.") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

/** 409 — state conflict (version clash, duplicate, already-claimed job). */
export class ConflictError extends ApiError {
  constructor(message = "That action conflicts with the current state.", details?: Record<string, unknown>) {
    super(409, "CONFLICT", message, { details });
    this.name = "ConflictError";
  }
}

/** 503 — a dependency is unavailable. Never includes the dependency's message. */
export class ServiceUnavailableError extends ApiError {
  constructor(message = "This service is temporarily unavailable. Please try again shortly.") {
    super(503, "UNAVAILABLE", message);
    this.name = "ServiceUnavailableError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Stable, non-sensitive description used for internal logs. */
export function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "NonErrorThrown", message: typeof error === "string" ? error : "non-error value thrown" };
}

/**
 * Turn any thrown value into a JSON response.
 *
 * `ApiError` → its own status and public message.
 * Everything else → 500 with a fixed message. The thrown message is *never*
 * echoed, because it routinely contains table names, file paths, tokens or
 * connection strings.
 */
export function toErrorResponse(error: unknown, requestId: string): NextResponse {
  const base: Record<string, string> = {
    "Cache-Control": "private, no-store",
    [REQUEST_ID_HEADER]: requestId,
  };

  if (isApiError(error)) {
    return NextResponse.json(
      {
        error: error.publicMessage,
        code: error.code,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status, headers: { ...base, ...(error.headers ?? {}) } },
    );
  }

  return NextResponse.json(
    {
      error: "Something went wrong on our side. Please try again.",
      code: "INTERNAL_ERROR",
      requestId,
    },
    { status: 500, headers: base },
  );
}

/** Convenience for handlers that return an error response directly. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "private, no-store", ...(headers as Record<string, string> | undefined) } },
  );
}

export { requestIdFrom };
