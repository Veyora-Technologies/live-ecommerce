import { describe, expect, it } from "vitest";
import {
  addProductPriceDeltaMinor,
  formatMinorAmount,
  minorAmountToDecimalString,
  multiplyMinorUnits,
  parseMajorAmountToMinor,
} from "@/lib/money";

describe("exact minor-unit money helpers", () => {
  it("formats NGN minor units without binary floating-point conversion", () => {
    expect(formatMinorAmount(123456789n, "NGN", "en-NG", 2)).toBe("₦1,234,567.89");
    expect(formatMinorAmount(110000, "NGN", "en-NG", 2)).toBe("₦1,100");
    expect(formatMinorAmount(1, "NGN", "en-NG", 2)).toBe("₦0.01");
  });

  it("respects currencies with zero or three minor-unit digits", () => {
    expect(formatMinorAmount(123456n, "JPY", "ja-JP", 0)).toContain("123,456");
    expect(formatMinorAmount(1234567n, "KWD", "en-KW", 3)).toContain("1,234.567");
  });

  it("serializes exact decimal values and rejects excess precision instead of rounding", () => {
    expect(minorAmountToDecimalString(123450n, 2)).toBe("1234.50");
    expect(minorAmountToDecimalString(-5n, 2)).toBe("-0.05");
    expect(parseMajorAmountToMinor("1234.5", 2)).toBe(123450n);
    expect(parseMajorAmountToMinor("1.005", 2)).toBeNull();
    expect(parseMajorAmountToMinor("2.675", 2)).toBeNull();
    expect(parseMajorAmountToMinor("1234.567", 2)).toBeNull();
    expect(parseMajorAmountToMinor("1e3", 2)).toBeNull();
  });

  it("adds signed variant deltas exactly and keeps effective prices in the product limit", () => {
    expect(addProductPriceDeltaMinor(12_345, 55)).toBe(12_400);
    expect(addProductPriceDeltaMinor(12_345, -45)).toBe(12_300);
    expect(() => addProductPriceDeltaMinor(100, -101)).toThrow(/variant price/i);
    expect(() => addProductPriceDeltaMinor(1_000_000_000, 1)).toThrow(/product price limit/i);
    expect(() => addProductPriceDeltaMinor(100, 0.5)).toThrow(/integer/i);
  });

  it("uses integer arithmetic and rejects totals that do not fit the legacy Int field", () => {
    expect(multiplyMinorUnits(110000, 3)).toBe(330000);
    expect(() => multiplyMinorUnits(1_000_000_000, 20)).toThrow(/field limit/i);
    expect(() => multiplyMinorUnits(1.5, 2)).toThrow(/integer/i);
  });
});
