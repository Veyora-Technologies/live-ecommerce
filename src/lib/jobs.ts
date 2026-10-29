import { prisma } from "./db";
import { scrubSecrets } from "./api-handler";

/**
 * Durable background-job queue.
 *
 * The repository already had a `BackgroundJob` table, but it was only ever
 * written to *after* work finished (as a log row), never used to *schedule*
 * anything. This module turns it into an actual queue.
 *
 * ## The properties that matter
 *
 * 1. **At-most-once claiming, even across instances.** A job is claimed with a
 *    conditional `updateMany` guarded on `status: PENDING`. Two workers that
 *    select the same row race on that update; exactly one gets `count: 1`. Both
 *    SQLite and PostgreSQL make a single UPDATE atomic, so this needs no
 *    advisory locks or `SELECT … FOR UPDATE`.
 *
 * 2. **Bounded retries with backoff.** A failing job is re-queued with an
 *    increasing delay, so a downstream outage is not hammered, and is moved to
 *    `DEAD_LETTER` after `maxAttempts` so one poison message cannot spin
 *    forever.
 *
 * 3. **Nothing is silently lost.** Unknown job types are never claimed (the
 *    query is filtered to registered handler types), and jobs orphaned by a
 *    worker that died mid-run are requeued by `requeueStuckJobs`.
 *
 * 4. **Failures never leak secrets.** `lastError` is scrubbed with the same
 *    scrubber the API error boundary uses, because provider errors routinely
 *    embed a credential.
 */

export {
  DEFAULT_MAX_ATTEMPTS,
  JOB_BACKOFF_MS,
  STUCK_JOB_AFTER_MS,
  backoffFor,
  parseJobPayload,
  type JobStatus,
  type JobHandler,
  type JobHandlers,
} from "./jobs-core";
import {
  DEFAULT_MAX_ATTEMPTS,
  STUCK_JOB_AFTER_MS,
  backoffFor,
  parseJobPayload,
  type JobHandlers,
  type JobRecord,
} from "./jobs-core";

/**
 * Add a job to the queue.
 *
 * `payload` must be JSON-serialisable and must not contain credentials — jobs
 * are visible to operators, and a payload is not a vault. If a job needs a
 * secret, store a reference (an id) and resolve it inside the handler.
 */
export async function enqueueJob(input: {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}): Promise<{ id: string }> {
  const created = await prisma.backgroundJob.create({
    data: {
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      status: "PENDING",
      nextRunAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Claim the next due job of a registered type.
 *
 * Returns null when there is nothing to do or when another worker won the race.
 */
export async function claimNextJob(
  options: { types?: readonly string[]; now?: Date } = {},
): Promise<JobRecord | null> {
  const now = options.now ?? new Date();
  const types = options.types;

  // An empty allow-list means "no handler is registered", which must claim
  // nothing rather than "claim anything".
  if (types && types.length === 0) return null;

  const candidate = await prisma.backgroundJob.findFirst({
    where: {
      status: "PENDING",
      ...(types ? { type: { in: [...types] } } : {}),
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, attempts: true, maxAttempts: true },
  });
  if (!candidate) return null;

  // The conditional update is the lock. If this returns 0, another worker
  // claimed it a moment ago and we simply move on.
  const claimed = await prisma.backgroundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;

  return prisma.backgroundJob.findUnique({
    where: { id: candidate.id },
    select: {
      id: true, type: true, payload: true, status: true,
      attempts: true, maxAttempts: true, nextRunAt: true, lastError: true,
    },
  }) as Promise<JobRecord | null>;
}

export async function completeJob(id: string): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: { id },
    data: { status: "SUCCESS", lastError: null, nextRunAt: null },
  });
}

/**
 * Record a failure and either re-queue with backoff or dead-letter.
 *
 * Returns the resulting status so the caller can report it.
 */
export async function failJob(
  job: { id: string; attempts: number; maxAttempts: number },
  error: unknown,
  options: { now?: Date } = {},
): Promise<"PENDING" | "DEAD_LETTER"> {
  const now = options.now ?? new Date();
  const message = error instanceof Error ? error.message : String(error);
  const lastError = scrubSecrets(message).slice(0, 500);
  const exhausted = job.attempts >= job.maxAttempts;

  await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: "PROCESSING" },
    data: exhausted
      ? { status: "DEAD_LETTER", lastError }
      : { status: "PENDING", lastError, nextRunAt: new Date(now.getTime() + backoffFor(job.attempts)) },
  });

  return exhausted ? "DEAD_LETTER" : "PENDING";
}

/**
 * Return jobs stuck in PROCESSING to the queue.
 *
 * A worker that crashes (or is redeployed) mid-job leaves rows in PROCESSING
 * forever. Without this they are lost silently, which is the worst possible
 * failure mode for a payment-adjacent queue.
 */
export async function requeueStuckJobs(
  options: { olderThanMs?: number; now?: Date; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.olderThanMs ?? STUCK_JOB_AFTER_MS));

  const stuck = await prisma.backgroundJob.findMany({
    where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
    select: { id: true },
    take: options.limit ?? 50,
  });
  if (stuck.length === 0) return 0;

  const result = await prisma.backgroundJob.updateMany({
    where: { id: { in: stuck.map((row) => row.id) }, status: "PROCESSING" },
    data: { status: "PENDING", nextRunAt: now, lastError: "Requeued after the worker stopped mid-job." },
  });
  return result.count;
}

export type RunSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  requeued: number;
  unknownTypes: string[];
};

/**
 * Drain due jobs, up to `limit`.
 *
 * Each job is run in isolation: a handler that throws affects only its own
 * record, so one broken job never stops the batch.
 */
export async function runDueJobs(options: {
  handlers: JobHandlers;
  limit?: number;
  now?: Date;
  requeueStuck?: boolean;
}): Promise<RunSummary> {
  const handlers = options.handlers;
  const types = Object.keys(handlers);
  const summary: RunSummary = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0, requeued: 0, unknownTypes: [] };

  if (options.requeueStuck !== false) {
    summary.requeued = await requeueStuckJobs({ now: options.now });
  }

  const limit = options.limit ?? 20;
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob({ types, now: options.now });
    if (!job) break;
    summary.claimed += 1;

    const handler = handlers[job.type];
    if (!handler) {
      // Cannot happen while `types` filters the claim, but fail closed rather
      // than leaving a claimed row stuck in PROCESSING.
      await failJob(job, new Error(`No handler registered for job type ${job.type}`), { now: options.now });
      summary.unknownTypes.push(job.type);
      continue;
    }

    try {
      await handler(parseJobPayload(job.payload), { id: job.id, type: job.type, attempt: job.attempts });
      await completeJob(job.id);
      summary.succeeded += 1;
    } catch (error) {
      const status = await failJob(job, error, { now: options.now });
      if (status === "DEAD_LETTER") summary.deadLettered += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}
