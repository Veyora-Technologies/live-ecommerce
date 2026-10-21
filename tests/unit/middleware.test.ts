import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("API proxy rate limits and request IDs", () => {
  it("keeps authentication and general API rate-limit buckets independent", () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const authRequest = () => new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip, origin: "http://localhost" },
    });

    for (let attempt = 0; attempt < 20; attempt++) expect(proxy(authRequest()).status).toBe(200);
    expect(proxy(authRequest()).status).toBe(429);

    const generalApi = proxy(new NextRequest("http://localhost/api/profile", {
      method: "GET",
      headers: { "x-forwarded-for": ip },
    }));
    expect(generalApi.status).toBe(200);
    expect(generalApi.headers.get("X-RateLimit-Limit")).toBe("240");
  });

  it("keeps webhook subscription mutations origin-protected while cron-authenticated jobs are exempt", () => {
    const webhook = proxy(new NextRequest("http://localhost/api/webhooks", {
      method: "POST",
      headers: { origin: "https://attacker.example", "x-forwarded-for": "198.51.100.244" },
    }));
    expect(webhook.status).toBe(403);

    // The route itself checks x-cron-secret before work; the proxy does not apply
    // cookie-CSRF validation to cron-only job routes.
    const job = proxy(new NextRequest("http://localhost/api/jobs/process", {
      method: "POST",
      headers: { origin: "https://attacker.example", "x-forwarded-for": "198.51.100.245" },
    }));
    expect(job.status).toBe(200);
  });

  it("relaxes auth limits only on explicitly marked demo SQLite integration servers", () => {
    const keys = ["NODE_ENV", "LIVE_DATA_MODE", "DATABASE_URL", "LIVE_TEST_RELAXED_RATE_LIMITS"] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const ip = "203.0.113.231";
    const authRequest = () => new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip, origin: "http://localhost" },
    });
    const setEnv = (values: { mode: string; databaseUrl: string }) => {
      Reflect.set(process.env, "NODE_ENV", "production");
      process.env.LIVE_TEST_RELAXED_RATE_LIMITS = "1";
      process.env.LIVE_DATA_MODE = values.mode;
      process.env.DATABASE_URL = values.databaseUrl;
    };

    try {
      setEnv({ mode: "demo", databaseUrl: "file:/tmp/live-middleware-test.sqlite" });
      for (let attempt = 0; attempt < 200; attempt++) expect(proxy(authRequest()).status).toBe(200);
      expect(proxy(authRequest()).status).toBe(429);

      setEnv({ mode: "production", databaseUrl: "file:/tmp/live-middleware-test.sqlite" });
      expect(proxy(authRequest()).status).toBe(503);

      setEnv({ mode: "demo", databaseUrl: "postgresql://localhost/test" });
      const isolatedIp = "203.0.113.232";
      const request = () => new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": isolatedIp, origin: "http://localhost" },
      });
      for (let attempt = 0; attempt < 20; attempt++) expect(proxy(request()).status).toBe(200);
      expect(proxy(request()).status).toBe(429);
    } finally {
      for (const key of keys) {
        const value = original[key];
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else Reflect.set(process.env, key, value);
      }
    }
  });

  it("replaces an oversized inbound request ID with a safe server ID", () => {
    const request = new NextRequest("http://localhost/api/v1/health", {
      headers: { "x-request-id": "x".repeat(200) },
    });
    const response = proxy(request);
    const requestId = response.headers.get("x-request-id") || "";
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
