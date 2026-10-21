import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canCustomize, merchantRole } from "@/lib/permissions";

const statusSchema = z.object({ storeStatus: z.enum(["OPEN", "CLOSED"]) }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await merchantRole(id, user.id);
  if (!canCustomize(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = statusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "storeStatus must be OPEN or CLOSED" }, { status: 400 });
  const merchant = await prisma.merchant.update({ where: { id }, data: { storeStatus: parsed.data.storeStatus } });
  return NextResponse.json({ merchant });
}
