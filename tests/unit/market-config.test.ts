import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKET_CODE,
  MARKET_REGISTRY,
  getActiveMarkets,
  getMarketConfiguration,
  getMarketMerchantWhere,
  getMarketProductWhere,
  isMarketFeatureOperational,
  isMarketIntegrationReady,
  merchantBelongsToMarket,
  productBelongsToMarket,
  validateMarketConfiguration,
} from "@/lib/market-config";

describe("market registry readiness guard", () => {
  it("keeps Nigeria as the only active market and default", () => {
    expect(DEFAULT_MARKET_CODE).toBe("NG");
    expect(getActiveMarkets().map((market) => market.countryCode)).toEqual(["NG"]);
  });

  it("does not treat a database country row or an unknown code as configured", () => {
    expect(getMarketConfiguration("GH")).toBeNull();
    expect(getMarketConfiguration("Nigeria")).toBeNull();
  });

  it("requires an explicitly READY integration before a provider-backed feature can be used", () => {
    expect(isMarketFeatureOperational("NG", "productDiscovery")).toBe(true);
    expect(isMarketFeatureOperational("NG", "deliveryIntegrations")).toBe(false);
    expect(isMarketIntegrationReady("NG", "deliveryIntegrations")).toBe(false);
  });

  it("does not assert configured payment, payout, fulfilment or legal readiness", () => {
    const nigeria = MARKET_REGISTRY.NG;
    expect(nigeria.providers.payments).toEqual([]);
    expect(nigeria.providers.settlement).toEqual([]);
    expect(nigeria.providers.fulfilment).toEqual([]);
    expect(nigeria.features.payments).toBe("DISABLED");
    expect(nigeria.features.payouts).toBe("DISABLED");
    expect(nigeria.readiness.legalReview).toBe("REVIEW_REQUIRED");
    expect(nigeria.readiness.privacyAndDataResidency).toBe("REVIEW_REQUIRED");
  });

  it("validates locale, timezone, ISO-style codes and currency precision", () => {
    expect(() => validateMarketConfiguration({
      ...MARKET_REGISTRY.NG,
      defaultTimezone: "Not/A_Timezone",
    })).toThrow();
  });

  it("limits legacy country-less merchant scope to Nigeria", () => {
    expect(getMarketMerchantWhere("NG")).toEqual({ OR: [{ countryCode: "NG" }, { countryCode: null }] });
    expect(getMarketProductWhere("NG").OR).toHaveLength(3);
    expect(() => getMarketProductWhere("GH")).toThrow(/not enabled/i);
  });

  it("uses the branch country as product market context and never re-labels foreign records as Nigeria", () => {
    expect(merchantBelongsToMarket({ countryCode: null }, "NG")).toBe(true);
    expect(merchantBelongsToMarket({ countryCode: null }, "GH")).toBe(false);
    expect(productBelongsToMarket({ merchant: { countryCode: null } }, "NG")).toBe(true);
    expect(productBelongsToMarket({ merchant: { countryCode: "GH" } }, "NG")).toBe(false);
    expect(productBelongsToMarket({ merchant: { countryCode: "GH" }, branch: { countryCode: "NG" } }, "NG")).toBe(true);
    expect(productBelongsToMarket({ merchant: { countryCode: "NG" }, branch: { countryCode: "GH" } }, "NG")).toBe(false);
  });
});
