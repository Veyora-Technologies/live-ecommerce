export type BookingInterval = { startTime: Date | number; endTime: Date | number };

function timestamp(value: Date | number) {
  return value instanceof Date ? value.getTime() : value;
}

export function validateServiceBookingWindow(startValue: string, endValue: string | undefined, durationMin: number | null, now = Date.now()) {
  const start = new Date(startValue);
  const defaultDuration = durationMin || 30;
  const end = endValue ? new Date(endValue) : new Date(start.getTime() + defaultDuration * 60_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Choose a valid start and end time");
  if (start.getTime() < now + 60_000) throw new Error("Choose an appointment time at least one minute in the future");
  if (start.getTime() > now + 366 * 24 * 60 * 60_000) throw new Error("Appointment requests are limited to the next 12 months");
  if (end <= start) throw new Error("Appointment end time must be after the start time");
  const duration = end.getTime() - start.getTime();
  if (duration > 12 * 60 * 60_000) throw new Error("Appointment duration cannot exceed 12 hours");
  if (durationMin && Math.abs(duration - durationMin * 60_000) > 60_000) throw new Error(`This service is listed as ${durationMin} minutes; choose an end time within one minute of that duration`);
  return { start, end };
}

/** Capacity is checked at each interval start boundary; intervals are half-open [start,end). */
export function hasServiceCapacity(existing: BookingInterval[], startValue: Date | number, endValue: Date | number, capacity: number) {
  const start = timestamp(startValue);
  const end = timestamp(endValue);
  const max = Math.max(1, Math.floor(capacity));
  const overlaps = existing.filter((item) => timestamp(item.startTime) < end && timestamp(item.endTime) > start);
  const eventPoints = [start, ...overlaps.map((item) => timestamp(item.startTime)).filter((time) => time >= start && time < end)];
  return !eventPoints.some((point) => overlaps.filter((item) => timestamp(item.startTime) <= point && timestamp(item.endTime) > point).length >= max);
}
