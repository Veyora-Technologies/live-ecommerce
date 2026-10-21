import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseMajorAmountToMinor } from "@/lib/money";

const privateHeaders = { "Cache-Control": "private, no-store" };
const createListSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  spendingLimit: z.union([z.literal(""), z.string().regex(/^\d{1,9}$/)]).optional(),
}).strict();

const listSelect = {
  id: true,
  name: true,
  description: true,
  spendingLimit: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      customName: true,
      quantity: true,
      checked: true,
      product: { select: { id: true, name: true, price: true, availability: true, merchant: { select: { businessName: true, area: true } } } },
    },
  },
  members: { select: { userId: true, role: true } },
} as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const lists = await prisma.shoppingList.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { updatedAt: "desc" },
    select: listSelect,
  });
  return NextResponse.json({ lists }, { headers: privateHeaders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const parsed = createListSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid list details", detail: parsed.error.issues[0]?.message }, { status: 400, headers: privateHeaders });
  const { name, description, spendingLimit } = parsed.data;
  const spendingLimitMinor = spendingLimit ? parseMajorAmountToMinor(spendingLimit, 2) : null;
  if (spendingLimit && (spendingLimitMinor === null || spendingLimitMinor > 2_147_483_647n)) {
    return NextResponse.json({ error: "The spending limit exceeds the supported exact Naira range." }, { status: 400, headers: privateHeaders });
  }

  const list = await prisma.shoppingList.create({
    data: {
      ownerId: user.id,
      name,
      description: description || null,
      spendingLimit: spendingLimitMinor === null ? null : Number(spendingLimitMinor),
      // The UI invites registered users directly; no public invite-token join flow exists.
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    select: { id: true, name: true, description: true, spendingLimit: true, items: { select: { id: true } } },
  });
  return NextResponse.json({ list }, { status: 201, headers: privateHeaders });
}
