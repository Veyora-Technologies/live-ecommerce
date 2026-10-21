import { prisma } from "./db";
import { DEFAULT_FRESHNESS, type FreshnessPolicyLike } from "./confidence";

/** DB-configurable freshness policies (§1). Falls back to coded defaults. */
export async function getFreshnessPolicy(category?: string | null): Promise<FreshnessPolicyLike> {
  if (category) {
    const row = await prisma.freshnessPolicy.findUnique({ where:{ category } }).catch(() => null);
    if (row) return { staleAfterHours: row.staleAfterHours, recentHours: row.recentHours };
  }
  return DEFAULT_FRESHNESS[category || ""] || DEFAULT_FRESHNESS.DEFAULT;
}
