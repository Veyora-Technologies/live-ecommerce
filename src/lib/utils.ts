import { formatCompactNairaMinor, formatNairaMinor, type MinorAmount } from "@/lib/money";

/** Legacy Nigeria-only wrapper: the persisted Product.price value is an integer in kobo. */
export function formatNaira(kobo: MinorAmount) {
  return formatNairaMinor(kobo);
}

/** Approximate abbreviation is marked explicitly; do not use this for transaction values. */
export function formatPriceCompact(kobo: MinorAmount) {
  return formatCompactNairaMinor(kobo);
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function timeAgo(date: Date | string) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function freshnessLabel(lastConfirmedAt: Date | string | null, updatedAt: Date | string) {
  const ref = lastConfirmedAt ? new Date(lastConfirmedAt) : new Date(updatedAt);
  const diffHrs = (Date.now() - ref.getTime()) / 3600000;
  if (diffHrs < 1) return { label: "Confirmed now", color: "green" };
  if (diffHrs < 6) return { label: `Confirmed ${Math.floor(diffHrs)}h ago`, color: "green" };
  if (diffHrs < 24) return { label: `Updated ${Math.floor(diffHrs)}h ago`, color: "amber" };
  return { label: `Stale • ${Math.floor(diffHrs / 24)}d ago`, color: "grey" };
}

export function generateCode() {
  return `LV-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export const ABUJA_AREAS = ["Wuse","Garki","Maitama","Asokoro","Wuye","Jabi","Utako","Gwarimpa","Kubwa","Central Area","Durumi","Lokogoma"];
export const CATEGORIES = ["Pharmacy","Supermarket","Provisions","Grocery","Health","Essentials"];

/**
 * Operating-hours evaluation (§30). Handles "24 hours", overnight ranges
 * (08:00-00:30) and single-range merchant-entered strings. Evaluated in the
 * merchant's timezone when provided; labels never claim precision we do not have.
 */
export function evaluateHours(weekdays?: string | null, saturday?: string | null, sunday?: string | null, timezone = "Africa/Lagos", now = new Date()): { label: "OPEN_NOW" | "CLOSED" | "UNKNOWN"; range: string | null; timezone: string } {
  let parts: Record<string, string> = {};
  try { parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(x => [x.type, x.value])); } catch { return { label: "UNKNOWN", range: null, timezone }; }
  const day = parts.weekday;
  const range = (day === "Sat" ? saturday : day === "Sun" ? sunday : weekdays) || weekdays || null;
  if (!range || range === "Closed") return { label: range === "Closed" ? "CLOSED" : "UNKNOWN", range, timezone };
  if (/24\s*hours/i.test(range)) return { label: "OPEN_NOW", range, timezone };
  const m = range.match(/(\d{1,2}):(\d{2})[^\d]+(\d{1,2}):(\d{2})/);
  if (!m) return { label: "UNKNOWN", range, timezone };
  const cur = Number(parts.hour) * 60 + Number(parts.minute);
  const open = Number(m[1]) * 60 + Number(m[2]);
  let close = Number(m[3]) * 60 + Number(m[4]);
  if (close <= open) close += 24 * 60; // overnight
  const curAdj = cur < open && close > 24 * 60 ? cur + 24 * 60 : cur;
  return { label: curAdj >= open && curAdj < close ? "OPEN_NOW" : "CLOSED", range, timezone };
}
