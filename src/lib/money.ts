export type MinorAmount = bigint | number | string;

export class MoneyAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyAmountError";
  }
}

/** The current Product.price field stores at most this many NGN kobo. */
export const MAX_PRODUCT_PRICE_MINOR = 1_000_000_000;

/** Add a signed variant delta to a product price without floating point or Int overflow. */
export function addProductPriceDeltaMinor(baseAmountMinor: number, priceDeltaMinor: number): number {
  if (!Number.isSafeInteger(baseAmountMinor) || baseAmountMinor < 0) {
    throw new MoneyAmountError("Base price must be a non-negative integer in minor units.");
  }
  if (!Number.isSafeInteger(priceDeltaMinor)) {
    throw new MoneyAmountError("Variant price delta must be an integer in minor units.");
  }
  const effective = BigInt(baseAmountMinor) + BigInt(priceDeltaMinor);
  if (effective < 0n || effective > BigInt(MAX_PRODUCT_PRICE_MINOR)) {
    throw new MoneyAmountError("The variant price must remain within the current product price limit.");
  }
  return Number(effective);
}

/** Parse an integer count of minor units without converting through binary floating point. */
export function toMinorBigInt(value: MinorAmount): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new MoneyAmountError("Minor-unit amount must be a safe integer.");
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) throw new MoneyAmountError("Minor-unit amount must be an integer string.");
  return BigInt(value.trim());
}

/** Convert a decimal major-unit input to exact minor units. Excess precision is rejected, never rounded. */
export function parseMajorAmountToMinor(value: string | number, minorUnitExponent: number): bigint | null {
  if (!Number.isInteger(minorUnitExponent) || minorUnitExponent < 0 || minorUnitExponent > 3) return null;
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > minorUnitExponent) return null;
  const scale = 10n ** BigInt(minorUnitExponent);
  const fractionalMinor = fraction ? BigInt(fraction.padEnd(minorUnitExponent, "0")) : 0n;
  return BigInt(match[1]) * scale + fractionalMinor;
}

/** Exact base-10 value suitable for JSON-LD and audit displays; no locale rounding. */
export function minorAmountToDecimalString(value: MinorAmount, minorUnitExponent: number, trimTrailingZeros = false): string {
  if (!Number.isInteger(minorUnitExponent) || minorUnitExponent < 0 || minorUnitExponent > 3) {
    throw new MoneyAmountError("Unsupported currency precision.");
  }
  const minor = toMinorBigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const scale = 10n ** BigInt(minorUnitExponent);
  const whole = minorUnitExponent ? absolute / scale : absolute;
  if (!minorUnitExponent) return `${negative ? "-" : ""}${whole}`;
  let fraction = (absolute % scale).toString().padStart(minorUnitExponent, "0");
  if (trimTrailingZeros) fraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : trimTrailingZeros ? "" : `.${"0".repeat(minorUnitExponent)}`}`;
}

function localizeDigits(value: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const digits = Array.from({ length: 10 }, (_, number) => formatter.format(BigInt(number)));
  return value.replace(/\d/g, (digit) => digits[Number(digit)]);
}

/**
 * Format exact minor-unit money using ICU's currency placement/grouping and the configured
 * currency precision. BigInt performs all authoritative arithmetic; no exchange or conversion
 * is implied. Trailing zero minor places are omitted for compact-but-exact display.
 */
export function formatMinorAmount(
  value: MinorAmount,
  currencyCode: string,
  locale: string,
  minorUnitExponent?: number,
): string {
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new MoneyAmountError("Use an ISO 4217 currency code.");
  const inferredExponent = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).resolvedOptions().maximumFractionDigits;
  const exponent = minorUnitExponent ?? inferredExponent;
  if (exponent === undefined || !Number.isInteger(exponent) || exponent < 0 || exponent > 3 || exponent !== inferredExponent) {
    throw new MoneyAmountError(`Unsupported precision for ${currencyCode}.`);
  }

  const minor = toMinorBigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const scale = 10n ** BigInt(exponent);
  const whole = exponent ? absolute / scale : absolute;
  const fraction = exponent ? (absolute % scale).toString().padStart(exponent, "0").replace(/0+$/, "") : "";
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  const wholeFormatter = new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 });
  const template = currencyFormatter.formatToParts(negative ? -1n : 1n);
  const output: string[] = [];
  let integerWritten = false;
  for (const part of template) {
    if (part.type === "integer") {
      if (!integerWritten) output.push(wholeFormatter.format(whole));
      integerWritten = true;
      continue;
    }
    if (part.type === "group") continue;
    if (part.type === "decimal" && !fraction) continue;
    if (part.type === "fraction") {
      if (fraction) output.push(localizeDigits(fraction, locale));
      continue;
    }
    output.push(part.value);
  }
  return output.join("");
}

/** The existing product schema stores NGN in kobo; keep this compatibility wrapper exact. */
export function formatNairaMinor(value: MinorAmount): string {
  return formatMinorAmount(value, "NGN", "en-NG", 2);
}

/** Compact UI label for legacy NGN callers. The tilde discloses that abbreviation is approximate. */
export function formatCompactNairaMinor(value: MinorAmount): string {
  const minor = toMinorBigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const sign = negative ? "-" : "";
  if (absolute >= 100_000_000n) {
    const tenthsOfMillion = (absolute + 5_000_000n) / 10_000_000n;
    const whole = tenthsOfMillion / 10n;
    const fraction = tenthsOfMillion % 10n;
    return `~${sign}₦${whole}${fraction ? `.${fraction}` : ""}M`;
  }
  if (absolute >= 100_000n) {
    const thousands = (absolute + 50_000n) / 100_000n;
    return `~${sign}₦${thousands}k`;
  }
  return formatNairaMinor(minor);
}

/**
 * Reservations currently persist Prisma Int minor-unit fields. Calculate with BigInt and fail
 * closed before writing if the exact total cannot fit that legacy signed 32-bit field.
 */
export function multiplyMinorUnits(unitAmountMinor: number, quantity: number): number {
  if (!Number.isSafeInteger(unitAmountMinor) || unitAmountMinor < 0) throw new MoneyAmountError("Unit price must be a non-negative integer in minor units.");
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new MoneyAmountError("Quantity must be a positive integer.");
  const total = BigInt(unitAmountMinor) * BigInt(quantity);
  if (total > 2_147_483_647n) throw new MoneyAmountError("The exact reservation total exceeds the current transaction field limit.");
  return Number(total);
}
