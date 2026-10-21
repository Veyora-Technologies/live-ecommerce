import { describe, expect, it } from "vitest";
import { bulkCurrencyError, formatBulkExportPrice, parseBulkImportPrice } from "@/lib/bulk-csv-money";

describe("bulk CSV currency safety", () => {
  it("requires an explicit NGN currency on every imported row", () => {
    expect(bulkCurrencyError("NGN")).toBeNull();
    expect(bulkCurrencyError(undefined)).toMatch(/currencyless prices are ambiguous/i);
    expect(bulkCurrencyError("")).toMatch(/currencyless prices are ambiguous/i);
    expect(bulkCurrencyError("USD")).toMatch(/does not convert/i);
  });

  it("parses only exact NGN major-unit values after currency validation", () => {
    expect(parseBulkImportPrice("1,234.50", "NGN")).toBe(123_450);
    expect(parseBulkImportPrice("₦ 1,234.5", "NGN")).toBe(123_450);
    expect(parseBulkImportPrice("1.005", "NGN")).toBeNull();
    expect(parseBulkImportPrice("1234.50", "USD")).toBeNull();
    expect(parseBulkImportPrice("1234.50", undefined)).toBeNull();
  });

  it("exports a price only when it can preserve the product currency and exact minor units", () => {
    expect(formatBulkExportPrice(123_450, "NGN")).toBe("1234.50");
    expect(formatBulkExportPrice(123_450, "USD")).toBeNull();
    expect(formatBulkExportPrice(123_450, "NGN ")).toBeNull();
  });
});
