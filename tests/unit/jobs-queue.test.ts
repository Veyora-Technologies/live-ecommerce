import { describe, expect, it } from "vitest";
import { JOB_BACKOFF_MS, STUCK_JOB_AFTER_MS, backoffFor, parseJobPayload } from "@/lib/jobs-core";

/**
 * Queue mechanics that do not need a database.
 *
 * The claim/retry logic that does touch Prisma is exercised by CI (which has a
 * real generated client); what is testable here is the maths that decides *when*
 * a job runs again, and the parser that must never let malformed JSON take the
 * worker down.
 */

describe("backoff", () => {
  it("waits progressively longer after each failure", () => {
    const delays = [1, 2, 3, 4].map(backoffFor);
    expect(delays).toEqual([...JOB_BACKOFF_MS]);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("clamps rather than returning undefined past the last step", () => {
    const last = JOB_BACKOFF_MS[JOB_BACKOFF_MS.length - 1];
    expect(backoffFor(99)).toBe(last);
    expect(Number.isFinite(backoffFor(99))).toBe(true);
  });

  it("treats attempt 0 as the first attempt", () => {
    expect(backoffFor(0)).toBe(JOB_BACKOFF_MS[0]);
  });

  it("never returns a negative delay", () => {
    for (const attempt of [-5, 0, 1, 2, 3, 4, 5, 100]) {
      expect(backoffFor(attempt)).toBeGreaterThan(0);
    }
  });

  it("declares a stuck-job threshold longer than the first retry delay", () => {
    // Otherwise a job could be reaped before it had a chance to retry.
    expect(STUCK_JOB_AFTER_MS).toBeGreaterThan(JOB_BACKOFF_MS[0]);
  });
});

describe("parseJobPayload", () => {
  it("round-trips an object", () => {
    expect(parseJobPayload('{"merchantId":"m1","count":3}')).toEqual({ merchantId: "m1", count: 3 });
  });

  it("survives malformed JSON without throwing", () => {
    const parsed = parseJobPayload("{not json");
    expect(parsed._unparseablePayload).toBe("{not json");
  });

  it("wraps a scalar payload instead of losing it", () => {
    expect(parseJobPayload('"just-a-string"')).toEqual({ value: "just-a-string" });
    expect(parseJobPayload("42")).toEqual({ value: 42 });
  });

  it("wraps an array payload", () => {
    expect(parseJobPayload("[1,2]")).toEqual({ value: [1, 2] });
  });

  it("caps how much of a bad payload is retained", () => {
    const huge = `{${"x".repeat(5000)}`;
    const parsed = parseJobPayload(huge);
    expect(String(parsed._unparseablePayload).length).toBeLessThanOrEqual(500);
  });
});
