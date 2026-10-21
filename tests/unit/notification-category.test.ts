import { describe, expect, it } from "vitest";
import { notificationCategory } from "@/lib/notification-category";

describe("shared in-app notification categories", () => {
  it("groups commerce and service status changes as activity", () => {
    expect(notificationCategory("RESERVATION_RECEIVED")).toBe("activity");
    expect(notificationCategory("BOOKING_CONFIRMED")).toBe("activity");
    expect(notificationCategory("QUOTE_ACCEPTED")).toBe("activity");
  });

  it("keeps security events distinct from marketing or activity", () => {
    expect(notificationCategory("SECURITY_LOGIN_LOCKOUT")).toBe("security");
    expect(notificationCategory("PASSWORD_RESET")).toBe("security");
  });

  it("classifies price and availability alerts and has a safe fallback", () => {
    expect(notificationCategory("PRICE_ALERT")).toBe("alerts");
    expect(notificationCategory("SAVED_SEARCH_MATCH")).toBe("alerts");
    expect(notificationCategory("SOMETHING_NEW")).toBe("updates");
  });
});
