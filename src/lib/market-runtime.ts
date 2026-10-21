import { prisma } from "@/lib/db";
import { getEnvStatus } from "@/lib/env";
import {
  DEFAULT_MARKET_CODE,
  getActiveMarketConfiguration,
  normalizeCountryCode,
  type MarketConfiguration,
} from "@/lib/market-config";

export class MarketUnavailableError extends Error {
  status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = "MarketUnavailableError";
    this.status = status;
  }
}

export function requestedMarketCode(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return DEFAULT_MARKET_CODE;
  const code = normalizeCountryCode(value);
  if (!code) throw new MarketUnavailableError("Choose a valid two-letter country code.", 400);
  return code;
}

/**
 * A request market must be present in the version-controlled allow-list, marked ACTIVE,
 * and backed by a matching active Country row. A database row alone cannot launch a market.
 */
export async function requireOperationalMarket(value?: string | null): Promise<MarketConfiguration> {
  if (process.env.NODE_ENV === "production" && !getEnvStatus().valid) {
    throw new MarketUnavailableError("This market is unavailable until Live's production database and launch configuration pass release review.", 503);
  }

  const code = requestedMarketCode(value);
  const configuration = getActiveMarketConfiguration(code);
  if (!configuration) throw new MarketUnavailableError("This country is not enabled on Live.", 404);

  const country = await prisma.country.findUnique({
    where: { code },
    select: { code: true, isActive: true, currencyCode: true, defaultLocale: true, defaultTimezone: true },
  });
  if (!country || !country.isActive) throw new MarketUnavailableError("This country is not currently available on Live.", 404);

  // Prevent serving a market with conflicting persisted defaults. Config changes require
  // a reviewed data migration rather than silently changing how prices or local times render.
  if (
    country.currencyCode !== configuration.defaultCurrencyCode ||
    country.defaultLocale !== configuration.defaultLocale ||
    country.defaultTimezone !== configuration.defaultTimezone
  ) {
    throw new MarketUnavailableError("Market configuration is temporarily unavailable. Please try again later.", 503);
  }
  return configuration;
}
