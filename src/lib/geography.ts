import { prisma } from "@/lib/db";
import { DEFAULT_MARKET_CODE } from "@/lib/market-config";
import { MarketUnavailableError, requireOperationalMarket } from "@/lib/market-runtime";

export type LocationScope = "nationwide" | "admin" | "locality" | "multi" | "nearby";

export class GeographyRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GeographyRequestError";
    this.status = status;
  }
}

/** Normalize user-entered geography text without changing the source display name. */
export function normalizeGeographyText(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

const merchantLocationFields = ["stateCode", "lgaCode", "cityCode", "localityCode"] as const;

/**
 * Resolve and validate a public search scope into an explicit merchant location predicate.
 * `admin` includes the selected admin area and known descendants; `locality` is exact;
 * `multi` is a union of 2-10 selected areas. `nearby` is intentionally unavailable until
 * Furnivo has adequate, consented user/merchant coordinates and an honest routing model.
 */
async function operationalGeographyMarket(countryCode: string) {
  try {
    return await requireOperationalMarket(countryCode);
  } catch (cause) {
    if (cause instanceof MarketUnavailableError) throw new GeographyRequestError(cause.message, cause.status);
    throw cause;
  }
}

export async function getGeographicScopeFilter(
  rawCodes: string[],
  scope: LocationScope,
  countryCode = DEFAULT_MARKET_CODE,
) {
  const market = await operationalGeographyMarket(countryCode);
  if (scope === "nearby") {
    throw new GeographyRequestError("Nearby search is not available because Furnivo does not have sufficiently verified location and routing data. Choose a locality or nationwide scope.", 422);
  }
  if (scope === "nationwide") return { where: {}, areas: [], codes: [] as string[], countryCode: market.countryCode };

  const codes = [...new Set(rawCodes.map((code) => code.trim()).filter(Boolean))];
  if (scope === "multi" && (codes.length < 2 || codes.length > 10)) {
    throw new GeographyRequestError("Choose between 2 and 10 locations for multi-location search.");
  }
  if (scope !== "multi" && codes.length !== 1) {
    throw new GeographyRequestError("Choose one location for this search scope.");
  }
  if (!codes.length) throw new GeographyRequestError(`Select a location, or choose all ${market.countryName}.`);

  const areas = await prisma.geographicArea.findMany({
    where: { code: { in: codes }, countryCode: market.countryCode, active: true },
    select: { code: true, name: true, type: true, parentCode: true },
  });
  if (areas.length !== codes.length) throw new GeographyRequestError(`One or more selected locations are unavailable. Choose a listed ${market.countryName} location.`);

  if (scope === "locality") {
    const invalidTypes = areas.filter((area) => !market.geography.localityTypes.includes(area.type));
    if (invalidTypes.length) throw new GeographyRequestError("Exact-locality search requires a supported lower-level administrative area. Choose an administrative-area or nationwide scope instead.");
  }

  let matchCodes = codes;
  if (scope === "admin" || scope === "multi") {
    const seen = new Set(codes);
    let frontier = codes;
    while (frontier.length) {
      const children = await prisma.geographicArea.findMany({
        where: { parentCode: { in: frontier }, countryCode: market.countryCode, active: true },
        select: { code: true },
        take: 1000,
      });
      frontier = children.map((child) => child.code).filter((code) => !seen.has(code));
      for (const code of frontier) seen.add(code);
      if (seen.size > 2000) throw new GeographyRequestError("This location hierarchy is too broad. Choose a smaller administrative area.");
    }
    matchCodes = [...seen];
  }

  const where = {
    OR: merchantLocationFields.map((field) => ({ [field]: { in: matchCodes } })),
  };
  return { where, areas, codes: matchCodes, countryCode: market.countryCode };
}

/** Product location can be its merchant's registered location or its explicitly assigned branch. */
export function getGeographicProductWhere(locationFilter: Awaited<ReturnType<typeof getGeographicScopeFilter>>, merchantStatus = "APPROVED") {
  if (!locationFilter.codes.length) return { merchant: { status: merchantStatus } };
  return {
    OR: [
      { merchant: { status: merchantStatus, ...locationFilter.where } },
      { merchant: { status: merchantStatus }, branch: locationFilter.where },
    ],
  };
}

export async function resolveLocationFromText(input: string, countryCode = DEFAULT_MARKET_CODE) {
  const pattern = /\b(?:in|at|around|within|near)\s+(.+)$/i;
  const match = pattern.exec(input);
  if (!match || !match[1] || /^(?:me|nearby|here)$/i.test(match[1].trim())) return null;

  const rawTail = match[1].trim();
  const tailWords = rawTail.split(/\s+/).slice(0, 7);
  const stopWords = new Set(["under", "over", "below", "above", "less", "more", "budget", "open", "stock", "available", "delivery", "pickup", "today", "tomorrow", "now", "with", "and"]);
  const candidatePhrases: string[] = [];
  for (let length = tailWords.length; length >= 1; length--) {
    const prefix = tailWords.slice(0, length);
    if (prefix.some((word) => stopWords.has(word.toLowerCase()) || /^[₦$0-9]/.test(word))) continue;
    const normalized = normalizeGeographyText(prefix.join(" "));
    if (normalized) candidatePhrases.push(normalized);
  }
  if (!candidatePhrases.length) return null;
  const market = await operationalGeographyMarket(countryCode);

  const rows = await prisma.geographicArea.findMany({
    where: {
      countryCode: market.countryCode,
      active: true,
      OR: [
        { normalizedName: { in: candidatePhrases } },
        { aliases: { some: { normalizedAlias: { in: candidatePhrases } } } },
      ],
    },
    include: {
      parent: { include: { parent: true } },
      aliases: { where: { normalizedAlias: { in: candidatePhrases } }, select: { normalizedAlias: true } },
    },
    take: 40,
  });
  const matches = rows.map((area: any) => {
    const exactCandidates = [area.normalizedName, ...area.aliases.map((alias: any) => alias.normalizedAlias)].filter((value) => candidatePhrases.includes(value));
    const phrase = exactCandidates.sort((a: string, b: string) => b.split(" ").length - a.split(" ").length || b.length - a.length)[0];
    const specificity = area.adminLevel;
    return { area, phrase, wordCount: phrase?.split(" ").length || 0, specificity };
  }).filter((item) => item.phrase).sort((a, b) => b.wordCount - a.wordCount || b.phrase!.length - a.phrase!.length || b.specificity - a.specificity || a.area.name.localeCompare(b.area.name));
  const best = matches[0];
  if (!best) return null;

  let wordsUsed = best.phrase!.split(" ").length;
  if (tailWords[wordsUsed]?.replace(/[.,]/g, "").toLowerCase() === market.countryName.toLowerCase()) wordsUsed++;
  const rawMatchedPhrase = tailWords.slice(0, wordsUsed).join(" ");
  const rawTailStart = input.toLowerCase().lastIndexOf(rawTail.toLowerCase());
  const locationStart = match.index ?? 0;
  const remainderStart = rawTailStart + rawMatchedPhrase.length;
  const cleanedQuery = `${input.slice(0, locationStart)} ${input.slice(remainderStart)}`.replace(/\s+/g, " ").trim();
  return { area: best.area, matchedText: rawMatchedPhrase, cleanedQuery };
}

export async function findGeographicArea(code: string, countryCode = DEFAULT_MARKET_CODE) {
  const market = await operationalGeographyMarket(countryCode);
  return prisma.geographicArea.findFirst({
    where: { code, countryCode: market.countryCode, active: true },
    include: { parent: { include: { parent: true } } },
  });
}

export function geographicPath(area: {
  name: string;
  type: string;
  parent?: { name: string; type: string; parent?: { name: string; type: string } | null } | null;
}) {
  const parents = [area.parent, area.parent?.parent].filter((item): item is { name: string; type: string } => Boolean(item && item.type !== "COUNTRY"));
  return [area.name, ...parents.map((item) => item.name)].join(" · ");
}
