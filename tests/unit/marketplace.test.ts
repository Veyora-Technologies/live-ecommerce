import { describe, expect, it } from "vitest";
import { isMarketplaceWorkflowImplemented, marketplaceListingJson, safeListingImageUrl } from "@/lib/marketplace";

const readyProduct = {
  listingKind: "PRODUCT",
  workflowKey: "PRODUCT_INVENTORY",
  readinessStatus: "READY",
  enabledForNewListings: true,
  visibleInSearch: true,
  requiresReview: true,
  requiresSellerVerification: false,
};

const readyService = {
  ...readyProduct,
  listingKind: "SERVICE",
  workflowKey: "SERVICE_BOOKING",
};

describe("marketplace workflow readiness", () => {
  it("allows only configured product and service workflows with moderation", () => {
    expect(isMarketplaceWorkflowImplemented(readyProduct)).toBe(true);
    expect(isMarketplaceWorkflowImplemented(readyService)).toBe(true);
  });

  it.each([
    ["planned property", { ...readyProduct, listingKind: "PROPERTY", workflowKey: "PROPERTY_DUE_DILIGENCE", readinessStatus: "PLANNED", enabledForNewListings: false, visibleInSearch: false, requiresSellerVerification: true }],
    ["unknown handler", { ...readyProduct, workflowKey: "UNIMPLEMENTED" }],
    ["seller verification not configured", { ...readyProduct, requiresSellerVerification: true }],
    ["moderation not configured", { ...readyProduct, requiresReview: false }],
    ["workflow/listing mismatch", { ...readyProduct, listingKind: "SERVICE" }],
    ["hidden category", { ...readyProduct, visibleInSearch: false }],
  ])("keeps %s unavailable", (_name, category) => {
    expect(isMarketplaceWorkflowImplemented(category as typeof readyProduct)).toBe(false);
  });
});

describe("marketplace public projection helpers", () => {
  it("only returns HTTPS listing images from allowed public hosts", () => {
    expect(safeListingImageUrl("https://images.example.com/product.jpg")).toBe("https://images.example.com/product.jpg");
    expect(safeListingImageUrl("http://images.example.com/product.jpg")).toBeNull();
    expect(safeListingImageUrl("https://127.0.0.1/private.jpg")).toBeNull();
    expect(safeListingImageUrl("javascript:alert(1)")).toBeNull();
  });

  it("serializes exact minor-unit prices without precision loss", () => {
    expect(marketplaceListingJson({ id: "a", priceAmountMinor: BigInt("9007199254740993123") })).toEqual({ id: "a", priceAmountMinor: "9007199254740993123" });
    expect(marketplaceListingJson({ id: "b", priceAmountMinor: null })).toEqual({ id: "b", priceAmountMinor: null });
  });
});
