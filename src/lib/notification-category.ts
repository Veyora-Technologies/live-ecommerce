export type NotificationCategory = "activity" | "alerts" | "security" | "business" | "updates";

export function notificationCategory(type: string): NotificationCategory {
  const normalized = type.toUpperCase();
  if (/SECURITY|LOGIN|PASSWORD|MFA|SESSION|SUSPICIOUS/.test(normalized)) return "security";
  if (/PRICE|AVAILABLE|SAVED_SEARCH|ALERT|LOW_STOCK|FRESHNESS/.test(normalized)) return "alerts";
  if (/RESERVATION|BOOKING|ORDER|QUOTE|ITEM_REQUEST|REQUEST_AN_ITEM|DELIVERY|ENQUIRY|PAYMENT/.test(normalized)) return "activity";
  if (/MERCHANT|BRANCH|INVENTORY|PRODUCT|TEAM|INTEGRATION|SERVICE/.test(normalized)) return "business";
  return "updates";
}
