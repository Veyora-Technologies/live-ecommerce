import { PrismaClient } from "@prisma/client";
import geography from "./data/nigeria-geography.json";
import { assertDemoSeedAllowed } from "./seed-safety";

const prisma = new PrismaClient();

type CandidateArea = (typeof geography.areas)[number];
const reviewedAt = new Date(`${geography.metadata.sourceReviewedAt}T00:00:00.000Z`);
const source = geography.metadata.sourceName;
const version = geography.metadata.sourceVersion;
const country = geography.country;
const COUNTRY_ROOT_CODE = geography.metadata.countryCode;

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

async function upsertArea(data: {
  code: string; sourceCode: string | null; parentCode: string | null; countryCode: string;
  name: string; normalizedName: string; type: string; adminLevel: number;
  latitude: number | null; longitude: number | null; dataSource: string; sourceVersion: string;
  sourceReviewedAt: Date; validOn: Date | null; verificationStatus: string; active: boolean;
}) {
  const { code, ...fields } = data;
  await prisma.geographicArea.upsert({ where: { code }, create: { code, ...fields }, update: fields });
}

async function main() {
  assertDemoSeedAllowed("Nigeria geography seed");
  await prisma.country.upsert({
    where: { code: country.code },
    create: {
      code: country.code,
      name: country.name,
      currencyCode: country.currencyCode,
      defaultTimezone: country.defaultTimezone,
      defaultLocale: country.defaultLocale,
      phoneCountryCode: country.phoneCountryCode,
      latitude: country.latitude,
      longitude: country.longitude,
      dataSource: country.dataSource,
      sourceVersion: country.sourceVersion,
      sourceReviewedAt: reviewedAt,
      isActive: true,
    },
    update: {
      name: country.name,
      currencyCode: country.currencyCode,
      defaultTimezone: country.defaultTimezone,
      defaultLocale: country.defaultLocale,
      phoneCountryCode: country.phoneCountryCode,
      latitude: country.latitude,
      longitude: country.longitude,
      dataSource: country.dataSource,
      sourceVersion: country.sourceVersion,
      sourceReviewedAt: reviewedAt,
      isActive: true,
    },
  });

  // The country root is also a selectable geography node, and is the parent of admin-1.
  await upsertArea({
    code: COUNTRY_ROOT_CODE,
    sourceCode: "NG",
    parentCode: null,
    countryCode: COUNTRY_ROOT_CODE,
    name: "Nigeria",
    normalizedName: normalized("Nigeria"),
    type: "COUNTRY",
    adminLevel: 0,
    latitude: country.latitude,
    longitude: country.longitude,
    dataSource: source,
    sourceVersion: version,
    sourceReviewedAt: reviewedAt,
    validOn: new Date(`${geography.metadata.sourceValidFrom}T00:00:00.000Z`),
    verificationStatus: "SOURCE_REVIEWED",
    active: true,
  });

  const areas = geography.areas as CandidateArea[];
  for (const area of areas) {
    if (area.parentCode !== COUNTRY_ROOT_CODE && !areas.some((candidate) => candidate.code === area.parentCode)) {
      throw new Error(`Unknown parent code ${area.parentCode} for ${area.code}`);
    }
    await upsertArea({
      code: area.code,
      sourceCode: area.sourceCode,
      parentCode: area.parentCode,
      countryCode: area.countryCode,
      name: area.name,
      normalizedName: normalized(area.name),
      type: area.type,
      adminLevel: area.adminLevel,
      latitude: area.latitude,
      longitude: area.longitude,
      dataSource: area.dataSource,
      sourceVersion: area.sourceVersion,
      sourceReviewedAt: reviewedAt,
      validOn: area.validOn ? new Date(`${area.validOn}T00:00:00.000Z`) : null,
      verificationStatus: area.verificationStatus,
      active: area.active,
    });

    for (const alias of area.aliases) {
      const normalizedAlias = normalized(alias);
      if (!normalizedAlias || normalizedAlias === normalized(area.name)) continue;
      await prisma.geographicAreaAlias.upsert({
        where: { areaCode_normalizedAlias: { areaCode: area.code, normalizedAlias } },
        create: { areaCode: area.code, alias, normalizedAlias, dataSource: source },
        update: { alias, dataSource: source },
      });
    }
  }

  const counts = await prisma.geographicArea.groupBy({
    by: ["type"],
    where: { countryCode: COUNTRY_ROOT_CODE, active: true },
    _count: { _all: true },
  });
  const total = counts.reduce((sum, item) => sum + item._count._all, 0);
  const countByType = Object.fromEntries(counts.map((item) => [item.type, item._count._all]));
  if (total < 849 || countByType.STATE !== 36 || countByType.TERRITORY !== 1 || countByType.LGA !== 768 || countByType.AREA_COUNCIL !== 6) {
    throw new Error(`Unexpected geography counts after seed: ${JSON.stringify(countByType)}; total=${total}`);
  }
  console.log(`Geography seeded: ${JSON.stringify(countByType)}; total active nodes ${total}.`);
}

main()
  .catch((error) => {
    console.error("Geography seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
