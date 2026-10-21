import { describe, expect, it } from "vitest";
import { hasServiceCapacity, validateServiceBookingWindow } from "@/lib/service-bookings";

const minute = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, minutes));

describe("service booking windows and capacity", () => {
  it("validates future windows and derives the configured duration", () => {
    const now = Date.UTC(2026, 0, 1, 9, 0);
    const window = validateServiceBookingWindow(new Date(now + 120 * minute).toISOString(), undefined, 30, now);
    expect(window.end.getTime() - window.start.getTime()).toBe(30 * minute);
    expect(() => validateServiceBookingWindow(new Date(now).toISOString(), undefined, 30, now)).toThrow(/future/);
  });

  it("rejects reversed and mismatched duration windows", () => {
    const now = Date.UTC(2026, 0, 1, 9, 0);
    expect(() => validateServiceBookingWindow(new Date(now + 120 * minute).toISOString(), new Date(now + 60 * minute).toISOString(), 30, now)).toThrow(/after the start/);
    expect(() => validateServiceBookingWindow(new Date(now + 120 * minute).toISOString(), new Date(now + 240 * minute).toISOString(), 30, now)).toThrow(/listed as 30 minutes/);
  });

  it("blocks overlap at capacity but permits adjacent half-open slots", () => {
    const existing = [{ startTime: at(0), endTime: at(30) }];
    expect(hasServiceCapacity(existing, at(15), at(45), 1)).toBe(false);
    expect(hasServiceCapacity(existing, at(30), at(60), 1)).toBe(true);
    expect(hasServiceCapacity(existing, at(15), at(45), 2)).toBe(true);
  });

  it("checks peak concurrent occupancy rather than total number of overlapping intervals", () => {
    const existing = [
      { startTime: at(0), endTime: at(30) },
      { startTime: at(30), endTime: at(60) },
    ];
    expect(hasServiceCapacity(existing, at(0), at(60), 1)).toBe(false);
    expect(hasServiceCapacity(existing, at(0), at(60), 2)).toBe(true);
  });
});
