import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";
import { minorAmountToDecimalString, parseMajorAmountToMinor } from "@/lib/money";

const MAX_PRODUCT_PRICE_MINOR = 1_000_000_000n;
const MARKET_CURRENCY = getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, "NGN");
const DEFAULT_CURRENCY = MARKET_CURRENCY?.code ?? "NGN";

/** Bulk CSV is currently NGN-only. Currency must be explicit on each row. */
export function bulkCurrencyError(currency: unknown): string | null {
  if (currency === DEFAULT_CURRENCY && MARKET_CURRENCY) return null;
  if (typeof currency !== "string" || !currency.trim()) {
    return `Currency is required for every row. Add an explicit ${DEFAULT_CURRENCY} currency column; currencyless prices are ambiguous and were not applied.`;
  }
  return `Only explicit ${DEFAULT_CURRENCY} rows are accepted; Live does not convert catalogue prices.`;
}

/** Parse a CSV price as exact major units only after its row explicitly identifies NGN. */
export function parseBulkImportPrice(value: string | number, currency: unknown): number | null {
  if (bulkCurrencyError(currency) !== null || !MARKET_CURRENCY) return null;
  const exponent = MARKET_CURRENCY.minorUnitExponent;
  const raw = String(value).trim();
  const text = raw.startsWith("₦") ? raw.slice(1).trim() : raw;
  const fraction = exponent > 0 ? `(?:\\.\\d{1,${exponent}})?` : "";
  if (!new RegExp(`^(?:\\d+|\\d{1,3}(?:,\\d{3})+)${fraction}$`).test(text)) return null;
  const minor = parseMajorAmountToMinor(text.replaceAll(",", ""), exponent);
  return minor !== null && minor <= MAX_PRODUCT_PRICE_MINOR ? Number(minor) : null;
}

/** Export only a supported currency; return null rather than labeling another currency as NGN. */
export function formatBulkExportPrice(value: number, currency: string): string | null {
  const configuration = getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, currency);
  if (!configuration || configuration.code !== DEFAULT_CURRENCY || currency !== configuration.code || !Number.isSafeInteger(value) || value < 0) return null;
  return minorAmountToDecimalString(value, configuration.minorUnitExponent);
}
