import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseNaturalQuery } from "@/lib/nlp";
import { DEFAULT_MARKET_CODE, isMarketIntegrationReady } from "@/lib/market-config";

const filtersSchema = z.record(z.string(), z.unknown()).optional();
const createSchema = z.object({
  query: z.string().trim().min(1).max(120),
  filters: filtersSchema,
  label: z.string().trim().max(60).optional(),
  alertEnabled: z.boolean().optional(),
  alertFrequency: z.enum(["INSTANT", "DAILY", "WEEKLY"]).optional(),
}).strict();
const updateSchema = createSchema.partial().extend({ id: z.string().min(1).max(40) }).strict();
const ALLOWED_FILTERS = new Set(["area", "category", "minPrice", "maxPrice", "sort", "inStock", "openNow", "pickup", "delivery", "verified"]);

function cleanFilters(filters?: Record<string, unknown>) {
  if (!filters) return null;
  if (Object.keys(filters).some((key) => ["distanceKm", "fulfilment"].includes(key))) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!ALLOWED_FILTERS.has(key)) continue;
    if (typeof value === "string" && value.length <= 120) clean[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean") clean[key] = value;
  }
  const packed = JSON.stringify(clean);
  return packed.length <= 1500 ? packed : undefined;
}
function unpackStoredFilters(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function hasDeliveryCriteria(query: string, filters?: Record<string, unknown> | null) {
  return parseNaturalQuery(query).delivery === true || filters?.delivery === true || filters?.delivery === "true";
}
const deliveryUnavailable = (query: string, filters?: Record<string, unknown> | null) =>
  hasDeliveryCriteria(query, filters) && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations");
const filterError = "One or more saved-search filters are not supported for alerts yet (including distance or fulfilment).";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const savedSearches = await prisma.savedSearch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ savedSearches }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid saved search", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 300) }, { status: 400 });
  const filters = cleanFilters(parsed.data.filters);
  if (filters === undefined) return NextResponse.json({ error: filterError }, { status: 400 });
  const existing = await prisma.savedSearch.findFirst({ where: { userId: user.id, query: parsed.data.query, filters } });
  const alertEnabled = parsed.data.alertEnabled ?? existing?.alertEnabled ?? false;
  const alertFrequency = parsed.data.alertFrequency ?? existing?.alertFrequency ?? "DAILY";
  if (alertEnabled && deliveryUnavailable(parsed.data.query, parsed.data.filters)) {
    return NextResponse.json({ error: "Delivery-based alerts are unavailable because Live has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const now = new Date();
  if (existing) {
    const wasEnabled = existing.alertEnabled;
    const savedSearch = await prisma.savedSearch.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label || null } : {}),
        alertEnabled, alertFrequency,
        ...(!wasEnabled && alertEnabled ? { lastEvaluatedAt: now, lastNotifiedAt: null } : {}),
      },
    });
    return NextResponse.json({ savedSearch, note: alertEnabled ? "Saved. In-app matching alerts check real merchant inventory events when the scheduler runs; no email or push message is sent." : "Saved to My Live." });
  }
  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId: user.id, query: parsed.data.query, filters,
      label: parsed.data.label || null, alertEnabled, alertFrequency,
      lastEvaluatedAt: now,
    },
  });
  return NextResponse.json({ savedSearch, note: alertEnabled ? "Saved. In-app matching alerts check only inventory events recorded after you enabled them, when the scheduler runs; no email or push message is sent." : "Saved to My Live." }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid saved-search update" }, { status: 400 });
  const { id, filters: rawFilters, ...fields } = parsed.data;
  const existing = await prisma.savedSearch.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Saved search not found" }, { status: 404 });
  const nextQuery = fields.query ?? existing.query;
  const nextFilters = rawFilters !== undefined ? rawFilters : unpackStoredFilters(existing.filters);
  const nextAlertEnabled = fields.alertEnabled ?? existing.alertEnabled;
  if (nextAlertEnabled && deliveryUnavailable(nextQuery, nextFilters)) {
    return NextResponse.json({ error: "Delivery-based alerts are unavailable because Live has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const data: Record<string, unknown> = {};
  if (fields.query !== undefined) data.query = fields.query;
  if (fields.label !== undefined) data.label = fields.label || null;
  if (fields.alertEnabled !== undefined) data.alertEnabled = fields.alertEnabled;
  if (fields.alertFrequency !== undefined) data.alertFrequency = fields.alertFrequency;
  let cleanedFilters: string | null | undefined;
  if (rawFilters !== undefined) {
    cleanedFilters = cleanFilters(rawFilters);
    if (cleanedFilters === undefined) return NextResponse.json({ error: filterError }, { status: 400 });
    data.filters = cleanedFilters;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "No changes supplied" }, { status: 400 });

  const criteriaChanged = fields.query !== undefined || (rawFilters !== undefined && cleanedFilters !== existing.filters);
  const isReenabled = fields.alertEnabled === true && !existing.alertEnabled;
  const resetEvaluation = criteriaChanged || isReenabled;
  const now = new Date();
  const savedSearch = await prisma.$transaction(async (tx) => {
    if (resetEvaluation) await tx.savedSearchMatch.deleteMany({ where: { savedSearchId: id } });
    return tx.savedSearch.update({
      where: { id },
      data: { ...data, ...(resetEvaluation ? { lastEvaluatedAt: now, lastNotifiedAt: null } : {}) },
    });
  });
  return NextResponse.json({ savedSearch, note: savedSearch.alertEnabled ? "Alert preference saved. In-app checks run only for new matching merchant inventory events after this update and only when the scheduler is configured." : "Saved search updated; matching alerts are paused." });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || id.length > 40) return NextResponse.json({ error: "id required" }, { status: 400 });
  const deleted = await prisma.savedSearch.deleteMany({ where: { id, userId: user.id } });
  if (!deleted.count) return NextResponse.json({ error: "Saved search not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
