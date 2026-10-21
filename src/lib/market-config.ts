/**
 * Version-controlled market registry.
 *
 * This is intentionally an allow-list, not a database flag or a promise of commercial
 * availability. A country must be deliberately configured here AND have a matching active
 * Country record before server operations can use it. Nigeria is the only active entry.
 */
export type MarketActivationStatus = "PLANNED" | "CONFIGURING" | "PILOT" | "ACTIVE" | "SUSPENDED";
export type ReadinessState = "CURRENT_FLOW" | "READY" | "PLANNED" | "DISABLED" | "NOT_CONFIGURED" | "REVIEW_REQUIRED" | "NOT_ASSESSED";
export type MarketFeature =
  | "productDiscovery"
  | "reservationRequests"
  | "appointmentRequests"
  | "sellerEnquiries"
  | "payments"
  | "payouts"
  | "refunds"
  | "deliveryIntegrations"
  | "crossBorderCommerce"
  | "multiCountryInventory";

export type MarketCurrency = {
  code: string;
  minorUnitExponent: number;
};

export type MarketConfiguration = {
  countryCode: string;
  countryName: string;
  activationStatus: MarketActivationStatus;
  defaultLocale: string;
  supportedLocales: readonly string[];
  defaultTimezone: string;
  defaultCurrencyCode: string;
  supportedCurrencies: readonly MarketCurrency[];
  phoneCountryCode: string;
  unitSystem: "METRIC" | "IMPERIAL" | "MIXED";
  geography: {
    rootCode: string;
    topLevelTypes: readonly string[];
    localityTypes: readonly string[];
    supportedLevels: readonly string[];
    sourcePath: string;
  };
  readiness: {
    legalReview: ReadinessState;
    privacyAndDataResidency: ReadinessState;
    identityVerification: ReadinessState;
    taxHandling: ReadinessState;
    payments: ReadinessState;
    settlementAndPayouts: ReadinessState;
    fulfilmentProviders: ReadinessState;
    supportOperations: ReadinessState;
  };
  features: Readonly<Record<MarketFeature, ReadinessState>>;
  providers: {
    payments: readonly string[];
    settlement: readonly string[];
    fulfilment: readonly string[];
    identity: readonly string[];
  };
};

export const DEFAULT_MARKET_CODE = "NG";

export const MARKET_REGISTRY = {
  NG: {
    countryCode: "NG",
    countryName: "Nigeria",
    activationStatus: "ACTIVE",
    defaultLocale: "en-NG",
    supportedLocales: ["en-NG"],
    defaultTimezone: "Africa/Lagos",
    defaultCurrencyCode: "NGN",
    supportedCurrencies: [{ code: "NGN", minorUnitExponent: 2 }],
    phoneCountryCode: "+234",
    unitSystem: "METRIC",
    geography: {
      rootCode: "NG",
      topLevelTypes: ["STATE", "TERRITORY"],
      localityTypes: ["LGA", "AREA_COUNCIL", "CITY", "LOCALITY", "WARD"],
      supportedLevels: ["STATE", "TERRITORY", "LGA", "AREA_COUNCIL", "CITY", "LOCALITY", "WARD"],
      sourcePath: "prisma/data/nigeria-geography.json",
    },
    // CURRENT_FLOW describes existing request/discovery workflows only. It does not certify
    // legal readiness, production readiness, merchant coverage, or completed fulfilment.
    readiness: {
      legalReview: "REVIEW_REQUIRED",
      privacyAndDataResidency: "REVIEW_REQUIRED",
      identityVerification: "REVIEW_REQUIRED",
      taxHandling: "NOT_CONFIGURED",
      payments: "NOT_CONFIGURED",
      settlementAndPayouts: "NOT_CONFIGURED",
      fulfilmentProviders: "NOT_CONFIGURED",
      supportOperations: "NOT_ASSESSED",
    },
    features: {
      productDiscovery: "CURRENT_FLOW",
      reservationRequests: "CURRENT_FLOW",
      appointmentRequests: "CURRENT_FLOW",
      sellerEnquiries: "CURRENT_FLOW",
      payments: "DISABLED",
      payouts: "DISABLED",
      refunds: "DISABLED",
      deliveryIntegrations: "NOT_CONFIGURED",
      crossBorderCommerce: "DISABLED",
      multiCountryInventory: "PLANNED",
    },
    // No provider is asserted as connected or operational by this configuration.
    providers: { payments: [], settlement: [], fulfilment: [], identity: [] },
  },
} satisfies Record<string, MarketConfiguration>;

const ACTIVATION_STATES = new Set<MarketActivationStatus>(["PLANNED", "CONFIGURING", "PILOT", "ACTIVE", "SUSPENDED"]);
const READINESS_STATES = new Set<ReadinessState>([
  "CURRENT_FLOW", "READY", "PLANNED", "DISABLED", "NOT_CONFIGURED", "REVIEW_REQUIRED", "NOT_ASSESSED",
]);

/** Validate a market record using built-in ICU locale, timezone and currency data. */
export function validateMarketConfiguration(config: MarketConfiguration): void {
  if (!/^[A-Z]{2}$/.test(config.countryCode)) throw new Error(`Invalid ISO 3166-1 country code: ${config.countryCode}`);
  if (!config.countryName.trim()) throw new Error(`Market ${config.countryCode} needs a display name`);
  if (!ACTIVATION_STATES.has(config.activationStatus)) throw new Error(`Invalid activation state for ${config.countryCode}`);

  const locales = [config.defaultLocale, ...config.supportedLocales];
  for (const locale of locales) {
    if (!locale || Intl.getCanonicalLocales(locale).length !== 1) throw new Error(`Invalid BCP 47 locale for ${config.countryCode}`);
  }
  if (!config.supportedLocales.includes(config.defaultLocale)) throw new Error(`Default locale is not supported for ${config.countryCode}`);
  new Intl.DateTimeFormat(config.defaultLocale, { timeZone: config.defaultTimezone }).format(0);

  if (!/^\+[1-9]\d{0,3}$/.test(config.phoneCountryCode)) throw new Error(`Invalid calling code for ${config.countryCode}`);
  if (!config.supportedCurrencies.length) throw new Error(`Market ${config.countryCode} must define a currency`);
  if (!config.supportedCurrencies.some((currency) => currency.code === config.defaultCurrencyCode)) {
    throw new Error(`Default currency is not supported for ${config.countryCode}`);
  }
  for (const currency of config.supportedCurrencies) {
    if (!/^[A-Z]{3}$/.test(currency.code)) throw new Error(`Invalid ISO 4217 currency code for ${config.countryCode}`);
    if (!Number.isInteger(currency.minorUnitExponent) || currency.minorUnitExponent < 0 || currency.minorUnitExponent > 3) {
      throw new Error(`Invalid minor-unit exponent for ${currency.code}`);
    }
    const intlExponent = new Intl.NumberFormat(config.defaultLocale, { style: "currency", currency: currency.code }).resolvedOptions().maximumFractionDigits;
    if (intlExponent !== currency.minorUnitExponent) throw new Error(`Configured precision for ${currency.code} does not match ICU currency metadata`);
  }
  if (config.geography.rootCode !== config.countryCode || !config.geography.sourcePath) {
    throw new Error(`Invalid geography root or source for ${config.countryCode}`);
  }
  for (const state of Object.values(config.readiness)) {
    if (!READINESS_STATES.has(state)) throw new Error(`Invalid readiness state for ${config.countryCode}`);
  }
  for (const state of Object.values(config.features)) {
    if (!READINESS_STATES.has(state)) throw new Error(`Invalid feature state for ${config.countryCode}`);
  }
}

for (const config of Object.values(MARKET_REGISTRY)) validateMarketConfiguration(config);

export function normalizeCountryCode(value: string | null | undefined): string | null {
  if (value == null || !/^[A-Za-z]{2}$/.test(value.trim())) return null;
  return value.trim().toUpperCase();
}

/** Returns only known config; callers must still enforce activation and persisted-country gates. */
export function getMarketConfiguration(value: string | null | undefined): MarketConfiguration | null {
  const code = normalizeCountryCode(value);
  return code ? MARKET_REGISTRY[code as keyof typeof MARKET_REGISTRY] ?? null : null;
}

export function getActiveMarketConfiguration(value: string | null | undefined): MarketConfiguration | null {
  const config = getMarketConfiguration(value);
  return config?.activationStatus === "ACTIVE" ? config : null;
}

export function getActiveMarkets(): MarketConfiguration[] {
  return Object.values(MARKET_REGISTRY).filter((config) => config.activationStatus === "ACTIVE");
}

/** A current request flow or explicitly READY feature is operational; planned/configuring states are not. */
export function isMarketFeatureOperational(countryCode: string, feature: MarketFeature): boolean {
  const market = getActiveMarketConfiguration(countryCode);
  const state = market?.features[feature];
  return state === "CURRENT_FLOW" || state === "READY";
}

/** Integrations require the stricter READY state; a database flag or planned workflow is insufficient. */
export function isMarketIntegrationReady(countryCode: string, feature: MarketFeature): boolean {
  return getActiveMarketConfiguration(countryCode)?.features[feature] === "READY";
}

export function getMarketCurrencyConfiguration(countryCode: string, currencyCode: string): MarketCurrency | null {
  const market = getActiveMarketConfiguration(countryCode);
  return market?.supportedCurrencies.find((currency) => currency.code === currencyCode.toUpperCase()) ?? null;
}

/** Merchant scope includes country-less legacy records only in the single current market (NG). */
export function getMarketMerchantWhere(countryCode: string) {
  const market = getActiveMarketConfiguration(countryCode);
  if (!market) throw new Error("Market is not enabled");
  return market.countryCode === "NG"
    ? { OR: [{ countryCode: "NG" }, { countryCode: null }] }
    : { countryCode: market.countryCode };
}

/**
 * Product inventory is scoped to its assigned branch when present; otherwise it follows the
 * merchant's operating country. Country-less legacy rows are visible only in Nigeria and are
 * not rewritten or guessed by this compatibility predicate.
 */
export function getMarketBranchWhere(countryCode: string) {
  const market = getActiveMarketConfiguration(countryCode);
  if (!market) throw new Error("Market is not enabled");
  return market.countryCode === "NG"
    ? { OR: [{ countryCode: "NG" }, { countryCode: null }] }
    : { countryCode: market.countryCode };
}

export function getMarketProductWhere(countryCode: string) {
  const merchantWhere = getMarketMerchantWhere(countryCode);
  const market = getActiveMarketConfiguration(countryCode);
  if (!market) throw new Error("Market is not enabled");
  return {
    OR: [
      { branchId: null, merchant: { is: merchantWhere } },
      { branch: { is: { countryCode: market.countryCode } } },
      { branch: { is: { countryCode: null } }, merchant: { is: merchantWhere } },
    ],
  };
}

export function merchantBelongsToMarket(merchant: { countryCode?: string | null } | null | undefined, countryCode: string): boolean {
  const market = getActiveMarketConfiguration(countryCode);
  if (!market || !merchant) return false;
  return merchant.countryCode === market.countryCode || (market.countryCode === "NG" && merchant.countryCode == null);
}

export function productBelongsToMarket(product: {
  merchant?: { countryCode?: string | null } | null;
  branch?: { countryCode?: string | null } | null;
}, countryCode: string): boolean {
  const market = getActiveMarketConfiguration(countryCode);
  if (!market) return false;
  const effectiveCountry = product.branch?.countryCode ?? product.merchant?.countryCode ?? null;
  return effectiveCountry === market.countryCode || (market.countryCode === "NG" && effectiveCountry == null);
}
