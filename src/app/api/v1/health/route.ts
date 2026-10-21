import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnvStatus } from "@/lib/env";

/** Public liveness/readiness response; provider configuration details stay private. */
export async function GET() {
  let database = "ok";
  let dbLatencyMs = 0;
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - startedAt;
  } catch {
    database = "unavailable";
  }

  const config = getEnvStatus();
  const ready = database === "ok" && config.valid;
  const version = process.env.LIVE_RELEASE_VERSION
    || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12)
    || process.env.GITHUB_SHA?.slice(0, 12)
    || "unknown";

  return NextResponse.json({
    status: ready ? "ok" : "degraded",
    service: "Live API v1",
    time: new Date().toISOString(),
    version,
    checks: { database, dbLatencyMs, configValid: config.valid, configErrors: config.errors.length },
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
