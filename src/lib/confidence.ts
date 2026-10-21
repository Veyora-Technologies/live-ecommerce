export type ConfidenceLabel = "Recently confirmed" | "Merchant reported" | "Availability may have changed" | "Awaiting confirmation" | "Currently unavailable";

/**
 * Evidence-based availability confidence (rule-based, no pretend ML).
 * Inputs: last merchant confirmation/update, availability state,
 * merchant confirmation rate (if recorded), stock vs threshold.
 * Labels never promise perfect accuracy.
 */
export type FreshnessPolicyLike = { staleAfterHours: number; recentHours: number };
export const DEFAULT_FRESHNESS: Record<string, FreshnessPolicyLike> = {
  Pharmacy: { staleAfterHours: 12, recentHours: 4 },
  Grocery: { staleAfterHours: 24, recentHours: 6 },
  Essentials: { staleAfterHours: 48, recentHours: 12 },
  Service: { staleAfterHours: 72, recentHours: 24 },
  DEFAULT: { staleAfterHours: 24, recentHours: 6 },
};
export function policyForCategory(category?: string | null): FreshnessPolicyLike {
  return DEFAULT_FRESHNESS[category || ""] || DEFAULT_FRESHNESS.DEFAULT;
}

export function availabilityConfidence(product: {
  availability?: string;
  category?: string | null;
  stockQuantity?: number;
  lastConfirmedAt?: Date | string | null;
  updatedAt?: Date | string;
  merchant?: { confirmationRate?: number | null; reliabilityScore?: number | null } | null;
}, policy?: FreshnessPolicyLike): { label: ConfidenceLabel; tone: "green"|"amber"|"red"|"grey"|"blue"; explanation: string; hoursStale: number } {
  const pol = policy || policyForCategory(product.category);
  if (product.availability === "OUT_OF_STOCK" || product.stockQuantity === 0) {
    return { label: "Currently unavailable", tone: "red", explanation: "Merchant records show no stock available for new reservations.", hoursStale: 0 };
  }
  if (!product.availability || product.availability === "UNKNOWN") {
    return { label: "Awaiting confirmation", tone: "grey", explanation: "No confirmed quantity on record. Call the merchant before travelling.", hoursStale: 999 };
  }
  const ref = product.lastConfirmedAt ? new Date(product.lastConfirmedAt) : product.updatedAt ? new Date(product.updatedAt) : null;
  if (!ref) return { label: "Awaiting confirmation", tone: "grey", explanation: "No confirmation timestamp recorded.", hoursStale: 999 };
  const hours = (Date.now() - ref.getTime()) / 3600000;
  if (hours <= pol.recentHours) return { label: "Recently confirmed", tone: "green", explanation: `Merchant record updated ${hours < 1 ? "within the last hour" : `${Math.floor(hours)}h ago`}.`, hoursStale: hours };
  if (hours <= pol.staleAfterHours) return { label: "Merchant reported", tone: "blue", explanation: `Last reported ${Math.floor(hours)}h ago (${product.category || "category"} freshness window: ${pol.staleAfterHours}h). A submitted reservation request creates a temporary hold while the merchant confirms.`, hoursStale: hours };
  return { label: "Availability may have changed", tone: "amber", explanation: `Not confirmed for ${Math.floor(hours/24)}d. Treat as stale: confirm by phone/WhatsApp before a long trip.`, hoursStale: hours };
}

/** Reservable quantity = physical - already reserved. Never negative. */
export function reservable(stockQuantity: number, reservedQuantity: number) {
  return Math.max(0, stockQuantity - reservedQuantity);
}

export function availabilityFromStock(stock: number, threshold: number) {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Stockout-risk heuristic (advisory only; only meaningful with history). */
export function stockoutRisk(opts: { stockQuantity: number; lowStockThreshold: number; reservationsLast7d?: number }) {
  const { stockQuantity, lowStockThreshold, reservationsLast7d = 0 } = opts;
  if (stockQuantity <= 0) return { level: "OUT", note: "Out of stock." };
  const daily = reservationsLast7d / 7;
  if (stockQuantity <= lowStockThreshold) return { level: "HIGH", note: `At/below low-stock threshold (${lowStockThreshold}). Review replenishment.` };
  if (daily > 0 && stockQuantity / daily < 3) return { level: "MEDIUM", note: `Roughly ${Math.floor(stockQuantity/Math.max(daily,0.1))} days of cover at recent reservation pace. Advisory only.` };
  return { level: "LOW", note: "No immediate stockout signal from current quantity and recent pace." };
}
