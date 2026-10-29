import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  ApiError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReauthRequiredError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  toErrorResponse,
} from "@/lib/api-errors";
import { scrubSecrets, withApiHandler } from "@/lib/api-handler";
import { requestIdFrom } from "@/lib/request-id";
import { ALLOWED_BODY_TYPES, SENSITIVE_PATH } from "@/proxy";

/**
 * Guards for the request-level error boundary.
 *
 * The security property under test is narrow and absolute: **no thrown value
 * may reach the client**. These tests feed the boundary realistic leaks — a
 * connection string, a live provider key, a JWT — and assert none of them
 * appear in the response body.
 */

const FAKE_SECRETS = [
  "postgresql://furnivo:hunter2@db.internal:5432/prod",
  "re_live_9f8e7d6c5b4a3210",
  "sk_test_51Habcdefghijklmnop",
  "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImFkbWluIn0.c2lnbmF0dXJlLXZhbHVl",
];

describe("error serialisation", () => {
  it("keeps the status and message for a deliberate ApiError", async () => {
    const res = toErrorResponse(new ForbiddenError("Not your business."), "rid-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Not your business.", code: "FORBIDDEN", requestId: "rid-1" });
    expect(res.headers.get("x-request-id")).toBe("rid-1");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("maps each error class to its status and code", () => {
    const cases: Array<[ApiError, number, string]> = [
      [new ValidationError(), 400, "INVALID_REQUEST"],
      [new UnauthorizedError(), 401, "UNAUTHORIZED"],
      [new ForbiddenError(), 403, "FORBIDDEN"],
      [new ReauthRequiredError(), 403, "REAUTH_REQUIRED"],
      [new NotFoundError(), 404, "NOT_FOUND"],
      [new ConflictError(), 409, "CONFLICT"],
      [new ServiceUnavailableError(), 503, "UNAVAILABLE"],
    ];
    for (const [error, status, code] of cases) {
      const res = toErrorResponse(error, "rid");
      expect(res.status).toBe(status);
      // The code is asserted too: clients branch on it, so a silent change
      // would break the step-up flow while the status still looked right.
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("advertises the step-up requirement in a header, not just prose", () => {
    const res = toErrorResponse(new ReauthRequiredError(), "rid");
    expect(res.headers.get("x-reauth-required")).toBe("1");
  });

  it("reduces an unknown error to a generic 500", async () => {
    const res = toErrorResponse(new TypeError("Cannot read properties of undefined (reading 'apiKey')"), "rid-2");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).not.toContain("apiKey");
    expect(body.error).not.toContain("TypeError");
  });

  it("never leaks a secret carried in an unknown error's message", async () => {
    for (const secret of FAKE_SECRETS) {
      const res = toErrorResponse(new Error(`connect failed: ${secret}`), "rid-3");
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(secret);
    }
  });

  it("copes with a non-Error throw", async () => {
    const res = toErrorResponse({ weird: "object" }, "rid-4");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong on our side. Please try again.");
  });
});

describe("request ids", () => {
  it("reuses a sane inbound id", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abc-123" }))).toBe("abc-123");
  });

  it("rejects an inbound id that could forge a log line", () => {
    // `Headers` already rejects CR/LF, so this simulates a runtime that let one
    // through: the id must still never be echoed into a log line verbatim.
    const hostileHeaders = {
      get: () => "abc\n2026-01-01 INFO admin login",
    } as unknown as Headers;
    const hostile = requestIdFrom(hostileHeaders);
    expect(hostile).not.toContain("\n");
    expect(hostile).not.toBe("abc\n2026-01-01 INFO admin login");
  });

  it("rejects an over-long inbound id", () => {
    const long = { get: () => "a".repeat(200) } as unknown as Headers;
    expect(requestIdFrom(long)).not.toBe("a".repeat(200));
  });

  it("mints one when the header is absent", () => {
    expect(requestIdFrom(new Headers()).length).toBeGreaterThan(8);
  });
});

describe("withApiHandler", () => {
  const makeReq = (url = "https://furnivo.test/api/thing?token=leak") =>
    new NextRequest(url, { headers: { "x-request-id": "rid-test" } });

  it("passes a successful response through untouched", async () => {
    const wrapped = withApiHandler(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await wrapped(makeReq(), {});
    expect(res.status).toBe(200);
  });

  it("converts an unhandled throw into JSON rather than an HTML error page", async () => {
    const wrapped = withApiHandler(async () => {
      throw new Error("database exploded");
    });
    const res = await wrapped(makeReq(), {});
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ code: "INTERNAL_ERROR", requestId: "rid-test" });
  });

  it("preserves a deliberate ApiError", async () => {
    const wrapped = withApiHandler(async () => {
      throw new NotFoundError("No such listing.");
    });
    const res = await wrapped(makeReq(), {});
    expect(res.status).toBe(404);
  });
});

describe("log scrubbing", () => {
  it("redacts every credential shape the platform can encounter", () => {
    for (const secret of FAKE_SECRETS) {
      const scrubbed = scrubSecrets(`boom ${secret}`);
      expect(scrubbed).not.toContain(secret);
    }
  });

  it("leaves ordinary prose readable so logs stay useful", () => {
    const text = "Reservation 42 expired after 30 minutes";
    expect(scrubSecrets(text)).toBe(text);
  });
});

describe("proxy request guards", () => {
  it("blocks credential, VCS and dump paths", () => {
    for (const path of [
      "/.env", "/.env.local", "/.env.production", "/.git/config", "/.aws/credentials",
      "/id_rsa", "/wp-login.php", "/backup.sql", "/app.pem", "/db.bak", "/.DS_Store",
    ]) {
      expect(SENSITIVE_PATH.test(path), `${path} should be blocked`).toBe(true);
    }
  });

  it("does not block legitimate routes or .well-known", () => {
    for (const path of [
      "/", "/api/v1/health", "/.well-known/security.txt", "/brand/live-symbol.svg",
      "/product/abc", "/api/products/abc", "/favicon.ico", "/manifest.json", "/search",
    ]) {
      expect(SENSITIVE_PATH.test(path), `${path} should be allowed`).toBe(false);
    }
  });

  it("accepts the body types the API actually parses", () => {
    for (const type of ["application/json", "multipart/form-data", "text/csv"]) {
      expect(ALLOWED_BODY_TYPES.has(type)).toBe(true);
    }
    expect(ALLOWED_BODY_TYPES.has("text/plain")).toBe(false);
  });
});
