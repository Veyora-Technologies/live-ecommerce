import { describe, expect, it } from "vitest";
import {
  REAUTH_WINDOW_MS,
  isReauthFresh,
  secondsUntilReauthExpiry,
} from "@/lib/reauth-core";

/**
 * Step-up freshness rules.
 *
 * These are pure functions precisely so they can be tested without a session
 * or a database — the failure mode that matters (a stale session being treated
 * as fresh) is a boundary condition, not an integration.
 */

const NOW = new Date("2026-10-29T12:00:00Z");

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("isReauthFresh", () => {
  it("accepts a proof made just now", () => {
    expect(isReauthFresh({ reauthenticatedAt: NOW }, NOW)).toBe(true);
  });

  it("accepts a proof inside the window", () => {
    expect(isReauthFresh({ reauthenticatedAt: at(-REAUTH_WINDOW_MS + 1000) }, NOW)).toBe(true);
  });

  it("treats the window edge as the last valid moment", () => {
    // "Valid for 15 minutes" should mean 15 minutes inclusive; what must not
    // happen is a proof surviving a millisecond longer.
    expect(isReauthFresh({ reauthenticatedAt: at(-REAUTH_WINDOW_MS) }, NOW)).toBe(true);
    expect(isReauthFresh({ reauthenticatedAt: at(-REAUTH_WINDOW_MS - 1) }, NOW)).toBe(false);
  });

  it("rejects a proof older than the window", () => {
    expect(isReauthFresh({ reauthenticatedAt: at(-REAUTH_WINDOW_MS - 1) }, NOW)).toBe(false);
  });

  it("rejects a session that never proved a password", () => {
    expect(isReauthFresh({ reauthenticatedAt: null }, NOW)).toBe(false);
    expect(isReauthFresh({}, NOW)).toBe(false);
  });

  it("rejects a timestamp from the future rather than trusting it", () => {
    // A clock that jumped forward — or a value an attacker managed to write —
    // must not produce an indefinitely valid proof.
    expect(isReauthFresh({ reauthenticatedAt: at(60_000) }, NOW)).toBe(false);
  });

  it("honours a caller-supplied window", () => {
    const proof = at(-5 * 60 * 1000);
    expect(isReauthFresh({ reauthenticatedAt: proof }, NOW, 10 * 60 * 1000)).toBe(true);
    expect(isReauthFresh({ reauthenticatedAt: proof }, NOW, 60 * 1000)).toBe(false);
  });
});

describe("secondsUntilReauthExpiry", () => {
  it("counts down inside the window", () => {
    expect(secondsUntilReauthExpiry({ reauthenticatedAt: at(-60_000) }, NOW)).toBe(
      Math.floor(REAUTH_WINDOW_MS / 1000) - 60,
    );
  });

  it("returns zero once the proof is spent", () => {
    expect(secondsUntilReauthExpiry({ reauthenticatedAt: at(-REAUTH_WINDOW_MS - 1) }, NOW)).toBe(0);
    expect(secondsUntilReauthExpiry({ reauthenticatedAt: null }, NOW)).toBe(0);
  });
});
