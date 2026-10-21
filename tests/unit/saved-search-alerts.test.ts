import { describe, expect, it } from "vitest";
import { matchesSavedSearch } from "@/lib/saved-search-alerts";

const product = {
  name: "Golden Penny Parboiled Rice 5kg",
  brand: "Golden Penny",
  category: "Grocery",
  price: 850000,
  availability: "IN_STOCK",
  merchant: { area: "Wuse", storeStatus: "OPEN", verificationStatus: "VERIFIED", pickupAvailable: true, deliveryAvailable: false },
};

describe("saved search matching", () => {
  it("matches natural-language product, area, and Naira price filters", () => {
    expect(matchesSavedSearch({ query: "Rice under ₦10,000 in Wuse", filters: null }, product)).toBe(true);
  });

  it("rejects an item over the saved budget and compares decimal Naira exactly", () => {
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ maxPrice: "8000" }) }, product)).toBe(false);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ maxPrice: "8500.00" }) }, product)).toBe(true);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ maxPrice: "8500.01" }) }, product)).toBe(true);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ minPrice: "8500.01" }) }, product)).toBe(false);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ maxPrice: "8500.001" }) }, product)).toBe(false);
  });

  it("rejects a result in another area or category", () => {
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ area: "Garki" }) }, product)).toBe(false);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ category: "Pharmacy" }) }, product)).toBe(false);
  });

  it("applies pickup filters while refusing unconfigured delivery criteria even when merchant flags are true", () => {
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ pickup: true }) }, product)).toBe(true);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ delivery: true }) }, product)).toBe(false);
    const merchantFlaggedDelivery = { ...product, merchant: { ...product.merchant, deliveryAvailable: true } };
    expect(matchesSavedSearch({ query: "rice delivery", filters: null }, merchantFlaggedDelivery)).toBe(false);
    expect(matchesSavedSearch({ query: "rice", filters: JSON.stringify({ delivery: true }) }, merchantFlaggedDelivery)).toBe(false);
  });
});
