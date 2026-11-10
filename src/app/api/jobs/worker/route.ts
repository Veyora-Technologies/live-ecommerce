import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { runDueJobs, enqueueJob, type JobHandlers } from "@/lib/jobs";
import { withApiHandler } from "@/lib/api-handler";

/**
 * POST /api/jobs/worker
 *
 * Drains the durable job queue. Called by the platform scheduler (or by hand
 * during an incident).
 *
 * ## Authentication
 *
 * Same contract as `/api/jobs/expire`: a cron secret, or an admin session when
 * no secret is configured in development. In production an unset secret is a
 * hard 503 rather than an open door — an unauthenticated endpoint that mutates
 * queued state is a denial-of-service vector.
 *
 * ## Registered handlers
 *
 * Handlers are registered here, not discovered: a queue that runs arbitrary
 * `type` values is a remote-code-execution shaped hole. Adding a job type means
 * adding it to this map and to whatever enqueues it.
 *
 *   SESSION_CLEANUP — deletes expired/revoked session and challenge rows.
 *   PING            — no-op; proves the pipeline end-to-end in tests and ops.
 */

/** How long a dead session or spent challenge is kept before deletion. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const handlers: JobHandlers = {
  PING: async (payload) => {
    return { echoedAt: new Date().toISOString(), received: Object.keys(payload) };
  },

  SESSION_CLEANUP: async () => {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    // Deleting a session row does not sign anyone out: a session is already
    // unusable once `revokedAt`/`expiresAt` has passed. This only reclaims the
    // storage and keeps the table small enough to scan quickly.
    const sessions = await prisma.session.deleteMany({
      where: {
        OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
    const challenges = await prisma.tokenChallenge.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return { sessionsDeleted: sessions.count, challengesDeleted: challenges.count };
  },
};

const noStore = { headers: { "Cache-Control": "private, no-store" } };

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured", code: "UNAVAILABLE" },
        { status: 503, ...noStore },
      );
    }
    const user = await getCurrentUser().catch(() => null);
    if (!user?.isAdmin) {
      return NextResponse.json(
        { error: "Admin authentication is required when CRON_SECRET is unset", code: "FORBIDDEN" },
        { status: 403, ...noStore },
      );
    }
    return null;
  }

  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, ...noStore });
  }
  return null;
}

export const POST = withApiHandler(async (req: NextRequest) => {
  const denied = await authorize(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const limit = Number(body?.limit);
  const summary = await runDueJobs({
    handlers,
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20,
  });

  return NextResponse.json(
    { ...summary, ranAt: new Date().toISOString() },
    noStore,
  );
}, { name: "jobs.worker" });

/** Queue a cleanup run. Useful for cron configs that only do GET-less scheduling. */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const denied = await authorize(req);
  if (denied) return denied;
  const job = await enqueueJob({ type: "SESSION_CLEANUP", payload: { requestedBy: "api" } });
  return NextResponse.json({ queued: job.id }, { status: 202, ...noStore });
}, { name: "jobs.worker.enqueue" });
