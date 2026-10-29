/**
 * Queue arithmetic and payload parsing (pure).
 *
 * Extracted from `jobs.ts` so the retry schedule and the JSON parser can be
 * tested without a database. `jobs.ts` re-exports everything here.
 */

/** Attempts are counted per claim, so this is "allowed runs in total". */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Delay before each retry, indexed by the attempt that just failed.
 * 30s → 2m → 10m → 1h. Deliberately jitter-free: this queue is low volume, and
 * predictable retries are easier to reason about during an incident.
 */
export const JOB_BACKOFF_MS: readonly number[] = [30_000, 120_000, 600_000, 3_600_000];

/** A job left in PROCESSING longer than this is assumed orphaned. */
export const STUCK_JOB_AFTER_MS = 15 * 60 * 1000;

export type JobStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "DEAD_LETTER";

export type JobRecord = {
  id: string;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date | null;
  lastError: string | null;
};

export type JobHandler = (
  payload: Record<string, unknown>,
  job: { id: string; type: string; attempt: number },
) => Promise<Record<string, unknown> | void>;

export type JobHandlers = Record<string, JobHandler>;

/** Parse a stored payload without letting malformed JSON kill the worker. */
export function parseJobPayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    // Preserve the original text so the operator can see what was stored.
    return { _unparseablePayload: raw.slice(0, 500) };
  }
}

/** Backoff for the attempt that just failed (1-based). */
export function backoffFor(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), JOB_BACKOFF_MS.length) - 1;
  return JOB_BACKOFF_MS[index];
}

