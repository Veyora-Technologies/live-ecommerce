import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPublicMarketplaceProduct, publicMarketplaceProductInTransaction } from "@/lib/marketplace";
import { parseMajorAmountToMinor } from "@/lib/money";
import { DEFAULT_MARKET_CODE, getMarketCurrencyConfiguration } from "@/lib/market-config";

const privateHeaders = { "Cache-Control": "private, no-store" };
const addItemSchema = z.object({
  productId: z.string().min(1).max(64).optional(),
  customName: z.string().trim().min(2).max(120).optional(),
  quantity: z.coerce.number().int().min(1).max(20).optional(),
}).strict().refine((value) => Boolean(value.productId) !== Boolean(value.customName), "Choose a listed product or enter a custom item");
const patchItemSchema = z.object({
  itemId: z.string().min(1).max(64),
  checked: z.boolean().optional(),
  quantity: z.coerce.number().int().min(1).max(20).optional(),
}).strict().refine((value) => value.checked !== undefined || value.quantity !== undefined, "No item change supplied");
const patchListSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  spendingLimit: z.union([z.literal(""), z.string().regex(/^\d{1,9}$/)]).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No list changes supplied");

const accessWhere = (id: string, userId: string) => ({
  id,
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

function invalidRequest(message: string) {
  return NextResponse.json({ error: "Invalid request", detail: message }, { status: 400, headers: privateHeaders });
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });

  // Private list reads require an owner or invited membership. An invite token is
  // not a public read capability and is not returned to clients.
  const list = await prisma.shoppingList.findFirst({
    where: accessWhere(id, user.id),
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      spendingLimit: true,
      owner: { select: { id: true, name: true } },
      members: { select: { role: true, user: { select: { id: true, name: true } } } },
      items: {
        select: {
          id: true,
          customName: true,
          quantity: true,
          checked: true,
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              currency: true,
              availability: true,
              stockQuantity: true,
              lastConfirmedAt: true,
              merchant: { select: { businessName: true, area: true, storeStatus: true } },
            },
          },
        },
      },
    },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });

  const items = list.items.map((item) => {
    if (!item.product) return { id: item.id, customName: item.customName, quantity: item.quantity, checked: item.checked, product: null, availabilityCheck: null, total: null as string | null };
    const currencyCode = item.product.currency || DEFAULT_MARKET_CODE;
    const currencySupported = Boolean(getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, currencyCode));
    const quantityIsValid = Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 20;
    const totalMinor = currencySupported && quantityIsValid
      ? BigInt(item.product.price) * BigInt(item.quantity)
      : null;
    return {
      id: item.id,
      customName: item.customName,
      quantity: item.quantity,
      checked: item.checked,
      product: { ...item.product, price: currencySupported ? item.product.price : null, currencyCode, priceAvailable: currencySupported },
      total: totalMinor === null ? null : totalMinor.toString(),
    };
  });
  const totalEstimateMinor = items.reduce((sum, item) => sum + (item.total === null ? 0n : BigInt(item.total)), 0n);
  const costEstimateComplete = items.every((item) => item.total !== null);
  const totalEstimate = totalEstimateMinor.toString();

  return NextResponse.json({
    list: {
      id: list.id,
      name: list.name,
      description: list.description,
      spendingLimit: list.spendingLimit,
      owner: { id: list.owner.id, name: list.owner.name },
      members: list.members.map((member) => ({ id: member.user.id, name: member.user.name, role: member.role })),
      items,
      totalEstimate,
      costEstimateComplete,
      withinBudget: list.spendingLimit !== null && costEstimateComplete ? totalEstimateMinor <= BigInt(list.spendingLimit) : null,
    },
  }, { headers: privateHeaders });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const parsed = addItemSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message || "Check the item details");

  const list = await prisma.shoppingList.findFirst({ where: accessWhere(id, user.id), select: { id: true } });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });

  if (parsed.data.productId) {
    const product = await prisma.product.findFirst({
      where: { id: parsed.data.productId, archived: false, merchant: { status: "APPROVED" } },
      select: { id: true, currency: true },
    });
    if (!product || !await isPublicMarketplaceProduct(product.id)) return NextResponse.json({ error: "Listed product is unavailable" }, { status: 404, headers: privateHeaders });
    if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) {
      return NextResponse.json({ error: "This listing's currency is not configured for money features in the active market.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: privateHeaders });
    }
  }

  let item;
  try {
    item = await prisma.$transaction(async (tx) => {
      if (parsed.data.productId) {
        const product = await tx.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true, archived: true, currency: true } });
        if (!product || product.archived || !await publicMarketplaceProductInTransaction(tx, parsed.data.productId)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
        if (!getMarketCurrencyConfiguration(DEFAULT_MARKET_CODE, product.currency || DEFAULT_MARKET_CODE)) throw new Error("CURRENCY_NOT_SUPPORTED");
      }
      return tx.shoppingListItem.create({
        data: {
          listId: id,
          productId: parsed.data.productId || null,
          customName: parsed.data.customName || null,
          quantity: parsed.data.quantity ?? 1,
        },
        select: { id: true, listId: true, productId: true, customName: true, quantity: true, checked: true },
      });
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "MARKETPLACE_LISTING_NOT_PUBLIC") return NextResponse.json({ error: "Listed product is unavailable" }, { status: 404, headers: privateHeaders });
    if (cause instanceof Error && cause.message === "CURRENCY_NOT_SUPPORTED") return NextResponse.json({ error: "This listing's currency is not configured for money features in the active market.", code: "CURRENCY_NOT_SUPPORTED" }, { status: 409, headers: privateHeaders });
    return NextResponse.json({ error: "List item could not be saved" }, { status: 500, headers: privateHeaders });
  }
  return NextResponse.json({ item }, { status: 201, headers: privateHeaders });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest("Expected a JSON object");

  if (Object.prototype.hasOwnProperty.call(body, "itemId")) {
    const parsed = patchItemSchema.safeParse(body);
    if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message || "Check the item update");
    const list = await prisma.shoppingList.findFirst({ where: accessWhere(id, user.id), select: { id: true } });
    if (!list) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
    const item = await prisma.shoppingListItem.findFirst({ where: { id: parsed.data.itemId, listId: id }, select: { id: true } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });

    const data = {
      ...(parsed.data.checked !== undefined ? { checked: parsed.data.checked } : {}),
      ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity } : {}),
    };
    const updated = await prisma.shoppingListItem.update({ where: { id: item.id }, data, select: { id: true, listId: true, productId: true, customName: true, quantity: true, checked: true } });
    return NextResponse.json({ item: updated }, { headers: privateHeaders });
  }

  const parsed = patchListSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message || "Check the list update");
  const list = await prisma.shoppingList.findFirst({ where: accessWhere(id, user.id), select: { ownerId: true } });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  if (list.ownerId !== user.id) return NextResponse.json({ error: "Only the owner can edit list details" }, { status: 403, headers: privateHeaders });

  const data: { name?: string; description?: string | null; spendingLimit?: number | null } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description || null;
  if (parsed.data.spendingLimit !== undefined) {
    const rawLimit = parsed.data.spendingLimit;
    const amountMinor = typeof rawLimit === "string" && rawLimit !== "" ? parseMajorAmountToMinor(rawLimit, 2) : null;
    if (typeof rawLimit === "string" && rawLimit !== "" && (amountMinor === null || amountMinor > 2_147_483_647n)) {
      return invalidRequest("The spending limit exceeds the supported exact Naira range.");
    }
    data.spendingLimit = amountMinor === null ? null : Number(amountMinor);
  }
  const updated = await prisma.shoppingList.update({
    where: { id },
    data,
    select: { id: true, name: true, description: true, spendingLimit: true, updatedAt: true },
  });
  return NextResponse.json({ list: updated }, { headers: privateHeaders });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const list = await prisma.shoppingList.findUnique({ where: { id }, select: { ownerId: true } });
  if (!list || list.ownerId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  await prisma.shoppingList.delete({ where: { id } });
  return NextResponse.json({ ok: true }, { headers: privateHeaders });
}
