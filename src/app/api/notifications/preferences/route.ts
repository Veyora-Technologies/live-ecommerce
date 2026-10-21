import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const preferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  alertsForAvailable: z.boolean().optional(),
  alertsForPriceChange: z.boolean().optional(),
  reorderReminders: z.boolean().optional(),
  merchantAnnouncements: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one preference is required" });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const preferences = await prisma.notificationPreference.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  return NextResponse.json({ preferences }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = preferencesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification preference payload" }, { status: 400 });
  const preferences = await prisma.notificationPreference.upsert({
    where: { userId: user.id }, update: parsed.data, create: { userId: user.id, ...parsed.data },
  });
  return NextResponse.json({ preferences }, { headers: { "Cache-Control": "private, no-store" } });
}
